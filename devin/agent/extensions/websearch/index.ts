/**
 * Web Search Tool using Brave Search API
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const BRAVE_API_KEY = "BSA4o5eYTdtyHIVF6nIz3uV1PWOOyTk";
const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

interface BraveSearchResponse {
  web: {
    results: Array<{
      title: string;
      url: string;
      description: string;
      age?: string;
      page_age?: string;
      extra_snippets?: string[];
    }>;
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: [
      "Search the web using Brave Search API.",
      "Provide a query and get back relevant web results with titles, URLs, and descriptions.",
      "Results include freshness indicators (age) when available.",
    ].join(" "),
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ description: "Number of results (default: 10, max: 20)" })),
    }),
    
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const count = Math.min(params.count ?? 10, 20);
      
      try {
        const url = `${BRAVE_API_URL}?q=${encodeURIComponent(params.query)}&count=${count}`;
        
        const response = await fetch(url, {
          headers: {
            "Accept": "application/json",
            "X-Subscription-Token": BRAVE_API_KEY,
          },
        });
        
        if (!response.ok) {
          throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
        }
        
        const data = (await response.json()) as BraveSearchResponse;
        
        if (!data.web?.results) {
          return {
            content: [{ type: "text", text: "No results found." }],
            details: {},
          };
        }
        
        const results = data.web.results.map((r, i) => {
          const age = r.age || r.page_age || "";
          const ageStr = age ? ` (${age})` : "";
          return `${i + 1}. ${r.title}\n   URL: ${r.url}${ageStr}\n   ${r.description}`;
        }).join("\n\n");
        
        return {
          content: [{ type: "text", text: `Web Search Results for "${params.query}"\n\n${results}` }],
          details: {
            query: params.query,
            count: data.web.results.length,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return {
          content: [{ type: "text", text: `Search failed: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });
}