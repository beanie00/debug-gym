# Paper Uploads

Use this folder for papers that do not yet have a public arXiv version, and for
copies whose URLs have already been shared publicly. Once a paper is on arXiv,
switch the site's links to `https://arxiv.org/pdf/<paper-id>`, but retain the hosted
PDF at its original path if tweets or other external links depend on it.

`ProgramDistill_arxiv.pdf` is retained for existing shared links. The homepage
and blog link to `https://arxiv.org/pdf/2609.18805` instead.

For blog posts, use `paper_local: "/static/papers/your-report.pdf"` in the post's front matter.
When the paper is on arXiv, replace `paper_local` with
`arxiv_url: "https://arxiv.org/pdf/<paper-id>"` so both the homepage card and blog
page link to the published version.

For a standalone Technical Report card, add a title, date, and
`link: "/static/papers/your-report.pdf"` to `docs/_data/papers.yml`.
The homepage applies the site's `baseurl` automatically.
