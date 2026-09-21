# Paper Uploads

Use this folder for papers that do not yet have a public arXiv version. Once one is
available, switch the site's links to `https://arxiv.org/pdf/<paper-id>` and remove
the redundant PDF after updating all references.

For blog posts, use `paper_local: "/static/papers/your-report.pdf"` in the post's front matter.
When the paper is on arXiv, replace `paper_local` with
`arxiv_url: "https://arxiv.org/pdf/<paper-id>"` so both the homepage card and blog
page link to the published version.

For a standalone Technical Report card, add a title, date, and
`link: "/static/papers/your-report.pdf"` to `docs/_data/papers.yml`.
The homepage applies the site's `baseurl` automatically.
