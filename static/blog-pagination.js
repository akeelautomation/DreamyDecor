(function () {
  const POSTS_PER_PAGE = 21;
  const style = document.createElement("style");
  style.textContent = `
    .postCard__thumb{
<<<<<<< HEAD
      width:min(112px, 42vw);
      aspect-ratio:9 / 16;
      margin:0 auto 14px;
      border-radius:14px;
=======
<<<<<<< HEAD
      width:min(124px, 46vw);
      aspect-ratio:9 / 16;
      margin:0 auto 14px;
=======
      width:100%;
      aspect-ratio:16 / 9;
      margin:0 0 14px;
>>>>>>> 43a66868bead044227e30bcc0b928e4d1d57327e
      border-radius:16px;
>>>>>>> 1a1fdac082b9c0b995145a62db40f30bcff8cc30
    }
    .postCard__thumb img{
      object-fit:cover;
    }
    .postCard__thumb img[src^="static/favicon"]{
<<<<<<< HEAD
      padding:22px;
=======
<<<<<<< HEAD
      padding:24px;
=======
      padding:28px;
>>>>>>> 43a66868bead044227e30bcc0b928e4d1d57327e
>>>>>>> 1a1fdac082b9c0b995145a62db40f30bcff8cc30
      object-fit:contain;
    }
  `;
  document.head.append(style);

  const grid = document.querySelector(".postGrid");
  const pager = document.querySelector("[data-blog-pager]");

  if (!grid || !pager) {
    return;
  }

  const posts = Array.from(grid.querySelectorAll(".postCard"));
  const pageCount = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  const params = new URLSearchParams(window.location.search);
  const requestedPage = Number(params.get("page") || "1");
  const currentPage = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), pageCount);
  const start = (currentPage - 1) * POSTS_PER_PAGE;
  const end = start + POSTS_PER_PAGE;

  posts.forEach((post, index) => {
    post.hidden = index < start || index >= end;
  });

  if (pageCount <= 1) {
    pager.hidden = true;
    return;
  }

  const pageUrl = (page) => {
    const url = new URL("blog.html", window.location.href);
    if (page === 1) {
      url.searchParams.delete("page");
    } else {
      url.searchParams.set("page", String(page));
    }
    return `blog.html${url.search}`;
  };

  const items = [];
  if (currentPage > 1) {
    items.push(`<a class="blogPager__link" href="${pageUrl(currentPage - 1)}">Previous</a>`);
  }

  for (let page = 1; page <= pageCount; page += 1) {
    if (page === currentPage) {
      items.push(`<span class="blogPager__link is-active" aria-current="page">${page}</span>`);
    } else {
      items.push(`<a class="blogPager__link" href="${pageUrl(page)}">${page}</a>`);
    }
  }

  if (currentPage < pageCount) {
    items.push(`<a class="blogPager__link" href="${pageUrl(currentPage + 1)}">Next</a>`);
  }

  pager.innerHTML = `
    <div class="blogPager__summary">Page ${currentPage} of ${pageCount}</div>
    <div class="blogPager__links">${items.join("")}</div>
  `;
})();
