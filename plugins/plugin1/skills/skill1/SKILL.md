# generate-apiexamples

Use when you need to generate representative API examples (request/response pairs, or message examples) from an existing OpenAPI or AsyncAPI contract and make them available in a Microcks instance.

## When to use

- You have an OpenAPI 3.x or AsyncAPI 2.x/3.x contract and want to create realistic mock data for it
- You want to enrich an existing Microcks service with additional examples
- You need to validate that generated examples conform to the contract schema

## What this skill does

1. Reads the provided API contract (OpenAPI or AsyncAPI)
2. Generates representative request/response (or message) examples covering happy paths and edge cases
3. Formats the examples as Microcks-compatible artifacts (`.yaml` or `.json`)
4. Guides you through importing them into Microcks via the Microcks API or UI

## Prerequisites

- A valid OpenAPI 3.x or AsyncAPI contract available locally or as a URL
- Access to a running Microcks instance (local or remote) — optional for generation, required for import

## References

- [Microcks documentation — Importing artifacts](https://microcks.io/documentation/guides/usage/importing-content/)
- [OpenAPI specification](https://spec.openapis.org/oas/latest.html)
- [AsyncAPI specification](https://www.asyncapi.com/docs/reference/specification/latest)
