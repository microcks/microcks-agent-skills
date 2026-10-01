# Contributing to Microcks

We love your input! We want to make contributing to this project as easy and transparent as possible.

## Contribution recogniton

We plan to use [All Contributors](https://allcontributors.org/docs/en/specification) specification to handle recognitions.

## Summary of the contribution flow

The following is a summary of the ideal contribution flow. Please, note that Pull Requests can also be rejected by the maintainers when appropriate.

```
    ┌───────────────────────┐
    │                       │
    │    Open an issue      │
    │  (a bug report or a   │
    │   feature request)    │
    │                       │
    └───────────────────────┘
               ⇩
    ┌───────────────────────┐
    │                       │
    │  Open a Pull Request  │
    │   (only after issue   │
    │     is approved)      │
    │                       │
    └───────────────────────┘
               ⇩
    ┌───────────────────────┐
    │                       │
    │   Your changes will   │
    │     be merged and     │
    │ published on the next │
    │        release        │
    │                       │
    └───────────────────────┘
```

## Code of Conduct

Microcks has adopted a Code of Conduct that we expect project participants to adhere to. Please [read the full text](CODE_OF_CONDUCT.md) so that you can understand what sort of behaviour is expected.

## Our Development Process

We use Github to host code, to track issues and feature requests, as well as accept pull requests.

## Issues

[Open an issue](https://github.com/microcks/microcks/issues/new) **only** if you want to report a bug or a feature. Don't open issues for questions or support, instead join our [Discord #support channel](https://microcks.io/discord-invite) or our [GitHub discussions](https://github.com/orgs/microcks/discussions) and ask there. 

## Bug Reports and Feature Requests

Please use our issues templates that provide you with hints on what information we need from you to help you out.

## Pull Requests

**Please, make sure you open an issue before starting with a Pull Request, unless it's a typo or a really obvious error.** Pull requests are the best way to propose changes to the specification. Take time to check the current working branch for the repository you want to contribute on before working :wink:

## Conventional commits

Our repositories follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary) specification. Releasing to GitHub and NPM is done with the support of [semantic-release](https://semantic-release.gitbook.io/semantic-release/).

Pull requests should have a title that follows the specification, otherwise, merging is blocked. If you are not familiar with the specification simply ask maintainers to modify. You can also use this cheatsheet if you want:

- `fix: ` prefix in the title indicates that PR is a bug fix and PATCH release must be triggered.
- `feat: ` prefix in the title indicates that PR is a feature and MINOR release must be triggered.
- `docs: ` prefix in the title indicates that PR is only related to the documentation and there is no need to trigger release.
- `chore: ` prefix in the title indicates that PR is only related to cleanup in the project and there is no need to trigger release.
- `test: ` prefix in the title indicates that PR is only related to tests and there is no need to trigger release.
- `refactor: ` prefix in the title indicates that PR is only related to refactoring and there is no need to trigger release.

What about MAJOR release? just add `!` to the prefix, like `fix!: ` or `refactor!: `

Prefix that follows specification is not enough though. Remember that the title must be clear and descriptive with usage of [imperative mood](https://chris.beams.io/posts/git-commit/#imperative).

Happy contributing :heart:

## Plugin and skill validation

Plugin contributions are checked by a deterministic, credential-free quality gate. It validates plugin manifests, marketplace registrations, README catalogue entries, license links, skill and agent frontmatter, portable references, external evaluation specifications, fixtures, and the minimum evidence needed for a Vally verdict.

Install the pinned validation dependency and run the same entry point used by CI:

```sh
npm ci --prefix eng/validation
bash eng/validate.sh --base-ref HEAD
```

The base comparison supports progressive adoption. Existing findings on an untouched component are reported as grandfathered debt. A new component, or a legacy component changed by the pull request, must satisfy the complete objective contract. Quality heuristics such as token range, document structure, and example density are warnings rather than merge blockers.

Every model-invocable distributed skill requires `tests/<plugin>/<skill>/eval.yaml`. A skill with `disable-model-invocation: true` is a reference skill and should be covered indirectly by its consumer instead. Every distributed agent requires `tests/<plugin>/agent.<agent>/eval.yaml`.

Model-backed Vally execution remains maintainer-controlled. It is never required to expose credentials to a pull request or fork. A maintainer can comment `/evals [plugin] [skill]` on your pull request; after environment approval, the results are posted as one aggregate comment on the pull request. Dashboard publication is currently disabled. When enabled, its history is updated only from an evaluated commit already merged into `main`, and contains aggregate verdict metrics rather than prompts or session trajectories.

## License

When you submit changes, your submissions are understood to be under the same [Apache 2.0 License](https://github.com/microcks/microcks/blob/master/LICENSE) that covers the project. Feel free to [contact the maintainers](https://github.com/microcks/.github/blob/main/MAINTAINERS.md) if that's a concern.

## References

This document was adapted from the open-source contribution guidelines for [Facebook's Draft](https://github.com/facebook/draft-js/blob/master/CONTRIBUTING.md).
