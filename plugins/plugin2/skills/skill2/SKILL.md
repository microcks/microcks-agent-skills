# init-config

Use when you need to add the Microcks Testcontainers Java module to a Maven or Gradle project and configure it so you can write contract tests (client-side or provider-side) using a real Microcks container.

## When to use

- You are starting a new Java project and want to use Microcks for contract testing
- You need to add the `microcks-testcontainers-java` dependency to an existing project
- You want to configure a `MicrocksContainer` in your JUnit 5 test setup

## What this skill does

1. Detects whether the project uses Maven (`pom.xml`) or Gradle (`build.gradle` / `build.gradle.kts`)
2. Adds the `io.github.microcks:microcks-testcontainers` dependency at the correct scope
3. Generates a `MicrocksContainer` bootstrap configuration (JUnit 5 extension or `@Container` field)
4. Configures artifact imports (OpenAPI / AsyncAPI contracts) in the test setup
5. Produces a minimal working test stub to verify the container starts correctly

## Prerequisites

- Java 11+ project using Maven or Gradle
- Docker available on the machine running the tests (required by Testcontainers)
- JUnit 5 on the test classpath

## References

- [Microcks Testcontainers Java — GitHub](https://github.com/microcks/microcks-testcontainers-java)
- [Microcks Testcontainers Java — Getting Started](https://microcks.io/documentation/guides/usage/testcontainers/)
- [Testcontainers Java documentation](https://java.testcontainers.org/)
