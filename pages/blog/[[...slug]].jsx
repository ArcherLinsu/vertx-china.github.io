import Blog from "../../components/layouts/Blog"
import BlogPost from "../../components/layouts/BlogPost"
import BlogDate from "../../components/blog/BlogDate"
import BlogEntry from "../../components/blog/BlogEntry"
import Pagination from "../../components/blog/Pagination"
import Alert from "../../components/Alert"
import Card from "../../components/Card"
import Cards from "../../components/Cards"
import Gist from "super-react-gist"
import Link from "next/link"
import Label from "../../components/Label"
import ScrollLink from "../../components/ScrollLink"
import { compile, run } from "@mdx-js/mdx"
import capitalize from "lodash/capitalize"
import matter from "gray-matter"
import * as runtime from "react/jsx-runtime"
import { useEffect, useState } from "react"

import { Clock } from "react-feather"
import SimpleIcon from "../../components/SimpleIcon"
import { siFacebook, siLinkedin, siTwitter } from "simple-icons/icons"
import Translation from "../../components/icon/Translation.js"

const MAX_ITEMS_PER_PAGE = 6

// components that will be available in mdx files
const COMPONENTS = {
  Alert,
  Card,
  Cards,
  Gist,
  Link,
  ScrollLink
}

let compileAllPostsCachedResult

async function compileAllPosts() {
  if (compileAllPostsCachedResult !== undefined) {
    return [compileAllPostsCachedResult, false]
  }

  const cacache = require("cacache")
  const crypto = require("crypto")
  const fs = require("fs").promises
  const readdir = require("recursive-readdir")
  const readingTime = require("reading-time")
  const { mdxOptions } = await import("../../components/lib/mdx-options")
  const { AutoBasePath } = await import("../../components/lib/remark-auto-basepath")
  const { TermFrequency } = await import("../../components/lib/remark-term-frequency")
  const { slash } = await import("../../components/lib/path-utils")

  const cachePath = "./.cache/blog3"

  let files = (await readdir("blog")).filter(f => {
    let e = slash(f).match(/.\/([0-9]+-[0-9]+-[0-9]+)-(.*)\.mdx/)
    if (e === null) {
      return false
    }
    if (e[2].indexOf(".") >= 0) {
      throw `Invalid blog post filename: ${f}. Dots '.' are not allowed.`
    }
    return true
  })

  // read front matter
  let posts = []
  let changed = false
  for (let f of files) {
    let source = await fs.readFile(f, "utf-8")
    let cacheKey = JSON.stringify({
      filename: f,
      basePath: process.env.basePath,
      sha: crypto.createHash("sha256").update(source).digest("hex")
    })

    let post
    let info = await cacache.get.info(cachePath, cacheKey)
    if (info !== null) {
      let cachedDocument = await cacache.get(cachePath, cacheKey)
      post = JSON.parse(cachedDocument.data.toString("utf-8"))
    } else {
      let { content, data } = matter(source)

      let e = slash(f).match(/.\/([0-9]+-[0-9]+-[0-9]+)-(.*)\.mdx/)
      let stats = readingTime(content)

      post = {
        filename: f,
        date: e[1],
        slug: e[2],
        meta: data,
        readingTime: stats
      }

      // render post
      let autoBasePath = new AutoBasePath(process.env.basePath)
      let tf = new TermFrequency()
      try {
        post.content = String(await compile(content, {
          ...mdxOptions,
          outputFormat: "function-body",
          jsx: false, // jsx cannot be eval'd
          remarkPlugins: [
            tf.apply(),
            autoBasePath.apply(),
            ...mdxOptions.remarkPlugins
          ]
        }))
      } catch (e) {
        console.error(`Failed to compile "${f}"`)
        throw e
      }
      post.tfIdfTerms = tf.result

      await cacache.put(cachePath, cacheKey, JSON.stringify(post))

      changed = true
    }

    posts.push(post)
  }

  posts.sort((a, b) => {
    // put pinned blog post at the beginning
    if (a.meta.pinned && !b.meta.pinned) {
      return -1
    } else if (!a.meta.pinned && b.meta.pinned) {
      return 1
    }
    // sort all posts by date
    return new Date(b.date) - new Date(a.date)
  })

  if (process.env.NODE_ENV === "production") {
    compileAllPostsCachedResult = posts
  }

  return [posts, changed]
}

async function writeFeed(allPosts, anyPostChanged) {
  const Feed = require("feed").Feed
  const fs = require("fs").promises

  // check if destination files already exist
  let exists = true
  try {
    await fs.access("public/feed/rss.xml")
    await fs.access("public/feed/atom.xml")
    await fs.access("public/feed/feed.json")
  } catch (e) {
    exists = false
  }

  if (anyPostChanged || !exists) {
    const feed = new Feed({
      title: "Vert.x",
      description: "Vert.x is a tool-kit for building reactive applications on the JVM",
      id: process.env.baseUrl,
      link: process.env.baseUrl,
      language: "en",
      favicon: `${process.env.baseUrl}/favicons/favicon.ico`,
      generator: "Vert.x",
      feedLinks: {
        rss2: `${process.env.baseUrl}/feed/rss.xml`,
        atom: `${process.env.baseUrl}/feed/atom.xml`,
        json: `${process.env.baseUrl}/feed/feed.json`
      }
    })

    for (let p of allPosts) {
      let url = `${process.env.baseUrl}/blog/${p.slug}`

      let authors = []
      for (let a of p.meta.authors) {
        let link = `https://github.com/${a.github_id}`
        authors.push({
          name: a.name,
          link
        })
      }

      feed.addItem({
        title: p.meta.title,
        id: url,
        link: url,
        description: p.meta.summary,
        date: new Date(p.date),
        category: [{ name: p.meta.category }],
        author: authors
      })
    }

    let allCategories = getAllCategories(allPosts)
    for (let c of allCategories) {
      feed.addCategory(c)
    }

    await fs.mkdir("public/feed", { recursive: true })
    await fs.writeFile("public/feed/rss.xml", feed.rss2(), "utf-8")
    await fs.writeFile("public/feed/atom.xml", feed.atom1(), "utf-8")
    await fs.writeFile("public/feed/feed.json", feed.json1(), "utf-8")
  }
}

function getAllCategories(allPosts) {
  let categories = new Set()
  for (let p of allPosts) {
    if (p.meta.category !== undefined) {
      categories.add(p.meta.category)
    }
  }
  return [...categories]
}

export async function getStaticPaths() {
  let [allPosts] = await compileAllPosts()
  let allCategories = getAllCategories(allPosts)
  let paths = allPosts.map(p => ({ params: { slug: [p.slug] } }))

  // catch categories
  for (let c of allCategories) {
    paths.push({
      params: {
        slug: ["category", c]
      }
    })
  }

  // catch pages
  let numPages = Math.ceil(allPosts.length / MAX_ITEMS_PER_PAGE)
  for (let p = 1; p < numPages; ++p) {
    paths.push({
      params: {
        slug: ["page", `${p + 1}`]
      }
    })
  }

  // catch pages for categories
  for (let c of allCategories) {
    let categoryPosts = allPosts.filter(p => p.meta.category === c)
    let nCategoryPages = Math.ceil(categoryPosts.length / MAX_ITEMS_PER_PAGE)
    for (let p = 1; p < nCategoryPages; ++p) {
      paths.push({
        params: {
          slug: ["category", c, "page", `${p + 1}`]
        }
      })
    }
  }

  // add blog index
  paths.push({ params: { slug: [] } })

  // 添加已翻译标签
  paths.push({
    params: {
      slug: ["translated"]
    }
  })
  let translatedPosts = allPosts.filter(p => p.meta.translators && p.meta.translators.length > 0)
  let nTranslatedPages = Math.ceil(translatedPosts.length / MAX_ITEMS_PER_PAGE)
  for (let p = 1; p < nTranslatedPages; ++p) {
    paths.push({
      params: {
        slug: ["translated", "page", `${p + 1}`]
      }
    })
  }
  return {
    paths,
    fallback: false
  }
}

// Only include those attributes that are really necessary for rendering
// to keep the bundle sizes small
function trimPost(post, includeDetails = false) {
  let result = {
    meta: post.meta,
    date: post.date,
    slug: post.slug
  }

  if (post.filename) {
    result.filename = post.filename
  }

  if (includeDetails) {
    result.readingTime = post.readingTime
    result.content = post.content
  }

  return result
}

function getTrimmedPostsForPage(allPosts, page, category = undefined, onlyTranslated = false) {
  // filter posts by category
  let posts = allPosts
  if (category !== undefined) {
    posts = posts.filter(p => p.meta.category === category)
  }
  if (onlyTranslated) {
    posts = posts.filter(p => p.meta.translators && p.meta.translators.length > 0)
  }

  // get current page
  let numPages = Math.ceil(posts.length / MAX_ITEMS_PER_PAGE)
  posts = posts.slice(MAX_ITEMS_PER_PAGE * (page - 1), MAX_ITEMS_PER_PAGE * page)
  posts = posts.map(p => trimPost(p))

  return {
    posts,
    numPages
  }
}

export async function getStaticProps({ params }) {
  const TfIdf = require("natural").TfIdf

  let [allPosts, anyPostChanged] = await compileAllPosts()
  let allCategories = getAllCategories(allPosts)

  const result = {
    categories: allCategories
  }

  // write RSS feed
  await writeFeed(allPosts, anyPostChanged)

  // handle blog index
  if (!params.slug || params.slug[0] === "[[...slug]]") {
    return {
      props: {
        ...result,
        ...getTrimmedPostsForPage(allPosts, 1)
      }
    }
  }

  let slug = params.slug[0]

  // handle page index
  if (slug === "page") {
    let page = parseInt(params.slug[1]) || 1
    return {
      props: {
        ...result,
        page,
        ...getTrimmedPostsForPage(allPosts, page)
      }
    }
  }

  // handle category index
  if (slug === "category") {
    let category = params.slug[1]

    // handle pages
    let page
    if (params.slug.length > 3 && params.slug[2] === "page") {
      page = parseInt(params.slug[3])
    }
    page = page || 1

    return {
      props: {
        ...result,
        category,
        page,
        ...getTrimmedPostsForPage(allPosts, page, category)
      }
    }
  }

  // 处理已翻译的首页
  if (slug === "translated") {
    // handle pages
    let page
    if (params.slug.length > 2 && params.slug[1] === "page") {
      page = parseInt(params.slug[2])
    }
    page = page || 1
    return {
      props: {
        ...result,
        page,
        translated: true,
        ...getTrimmedPostsForPage(allPosts, page, undefined, true)
      }
    }
  }

  // handle blog posts
  let postIndex = allPosts.findIndex(p => p.slug === slug)
  let post = allPosts[postIndex]

  // initialize tf-idf
  let tfidf = new TfIdf()
  allPosts.forEach(p => {
    let doc = {}
    p.tfIdfTerms.forEach(t => doc[t.term] = t.tf)
    tfidf.addDocument(doc)
  })

  // calculate related posts based on tf-idf
  let relatedPosts = tfidf.tfidfs(post.tfIdfTerms.map(t => t.term))
    .map((f, i) => ({ f, date: allPosts[i].date, meta: allPosts[i].meta, slug: allPosts[i].slug, filename: allPosts[i].filename }))
    .sort((a, b) => b.f - a.f) // sort by tf-idf (best matches first)
    .filter(p => p.slug !== slug) // remove current post
    .slice(0, 3) // select best three matches

  // get next post and previous post
  let prevPost = null
  let nextPost = null
  if (postIndex > 0) {
    prevPost = allPosts[postIndex - 1]
  }
  if (postIndex < allPosts.length - 1) {
    nextPost = allPosts[postIndex + 1]
  }

  return {
    props: {
      ...result,
      post: trimPost(post, true),
      prevPost: prevPost && trimPost(prevPost),
      nextPost: nextPost && trimPost(nextPost),
      relatedPosts: relatedPosts.map(rp => trimPost(rp))
    }
  }
}

const BlogPage = ({ post, prevPost, nextPost, relatedPosts, category, translated, categories,
    page, posts, numPages }) => {
  const [mdxModule, setMdxModule] = useState()

  useEffect(() => {
    (async () => {
      if (post?.content !== undefined) {
        setMdxModule(await run(post.content, runtime))
      }
    })()
  }, [post?.content])

  if (post === undefined) {
    let entries = posts.map(p => <BlogEntry key={p.slug} post={p} />)

    let title = "博客"
    if (category !== undefined) {
      title = `${capitalize(category)} | ${title}`
    }
    if (translated) {
      title = `已翻译 | ${title}`
    }
    if (page > 1) {
      title = `第${page}页 | ${title}`
    }

    return (
      <Blog title={title} categories={categories}>
        <div className="blog-entries">
          {entries}
        </div>
        <Pagination currentPage={page} numPages={numPages} category={category} translated={translated} />
      </Blog>
    )
  }

  let url = `${process.env.baseUrl}/blog/${post.slug}`

  return (
    <BlogPost title={`${post.meta.title} | 博客`} categories={categories}>
      <div className="blog-post-main">
        <div className="blog-post-content">
          <h1>{post.meta.title}</h1>
          {mdxModule?.default && <mdxModule.default components={COMPONENTS} /> || <></>}
        </div>

        <div className="blog-post-sidebar">
          {post.meta.authors.map(author => (
            <div className="blog-post-author" key={author.github_id}>
              <img className="blog-post-author-avatar"
                src={`https://github.com/${author.github_id}.png?size=160`}
                alt={`${author.name}'s profile image`} />
              <div className="blog-post-author-name">
                {post.meta.authors.length === 1 && "by "}<a href={`https://github.com/${author.github_id}`}
                  target="_blank" rel="noopener noreferrer">{author.name}</a>
              </div>
            </div>
          ))}
          {post.meta.translators && <div className="blog-post-sidebar-pinned"><strong>译者</strong></div>}
          {post.meta.translators && post.meta.translators.map(author => (
              <div className="blog-post-author" key={author.github_id}>
                <img className="blog-post-author-avatar"
                     src={`https://github.com/${author.github_id}.png?size=160`}
                     alt={`${author.name}'s profile image`} />
                <div className="blog-post-author-name">
                  {post.meta.translators.length === 1 && "by "}<a href={`https://github.com/${author.github_id}`}
                                                              target="_blank" rel="noopener noreferrer">{author.name}</a>
                </div>
              </div>
          ))}
          {post.meta.pinned && <div className="blog-post-sidebar-pinned"><Label dark><strong>置顶文章</strong></Label></div>}
          {post.meta.pinned || <><div className="blog-post-sidebar-date">发表于 <BlogDate date={post.date} /></div>
          分类 <Link href="/blog/[[...slug]]" as={`/blog/category/${post.meta.category}/`}>
            <a className="blog-post-sidebar-category">{post.meta.category}</a>
          </Link></>}
          <div className="blog-post-sidebar-pinned"><Label small tiny><strong><a href={`https://github.com/vertx-china/vertx-china.github.io/edit/master/${post.filename}`}><Translation className="feather" />{post.meta.translators !== undefined ? "改进翻译" : "翻译本文"}</a></strong></Label></div>
          <div className="blog-post-sidebar-reading-time"><Clock className="feather" /> {post.readingTime.text}</div>
          <div className="blog-post-sidebar-share-icons">
            <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.meta.title)}&url=${encodeURIComponent(url)}&via=vertx_project`}
                target="_blank" rel="noopener noreferrer">
              <SimpleIcon icon={siTwitter} />
            </a>
            <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
                target="_blank" rel="noopener noreferrer">
              <SimpleIcon icon={siLinkedin} />
            </a>
            <a href={`https://www.facebook.com/sharer.php?u=${encodeURIComponent(url)}`}
                target="_blank" rel="noopener noreferrer">
              <SimpleIcon icon={siFacebook} />
            </a>
          </div>
        </div>
      </div>

      <div className="blog-post-next-prev">
        <div className="blog-post-next-prev-entry">
          {prevPost && (<>
            <h5>Next post</h5>
            <BlogEntry post={prevPost} />
          </>)}
        </div>

        <div className="blog-post-next-prev-entry">
          {nextPost && (<>
            <h5>Previous post</h5>
            <BlogEntry post={nextPost} />
          </>)}
        </div>
      </div>

      <div className="blog-post-related">
        <h5>Related posts</h5>
        <div className="blog-post-related-posts">
          {relatedPosts.map(rp => <BlogEntry key={rp.slug} post={rp} />)}
        </div>
      </div>
    </BlogPost>
  )
}

export default BlogPage
