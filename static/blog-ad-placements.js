(function () {
  const article = document.querySelector(".docCard.prose");
  const main = document.querySelector("main.doc");

  if (!article || !main || document.querySelector("[data-blog-ad-placement]")) {
    return;
  }

  const ads = [
    {
      title: "Fresh decor picks",
      copy: "New chairs, shelves, lighting, and easy room upgrades.",
      href: "picks-latest.html",
      cta: "Shop latest",
    },
    {
      title: "Small room upgrades",
      copy: "Compact storage, mirrors, baskets, lamps, and fast fixes.",
      href: "picks-small-wins.html",
      cta: "Browse picks",
    },
    {
      title: "Living room finds",
      copy: "Accent chairs, coffee tables, shelves, and cozy seating.",
      href: "picks-living.html",
      cta: "See products",
    },
  ];

  function pickAd() {
    const key = Math.abs(
      Array.from(window.location.pathname).reduce((sum, char) => sum + char.charCodeAt(0), 0)
    );
    return ads[key % ads.length];
  }

  function createPlacement(type) {
    const ad = pickAd();
    const wrap = document.createElement(type === "desktop" ? "aside" : "div");
    wrap.className = type === "desktop" ? "blogAdRail" : "blogAdInline";
    wrap.dataset.blogAdPlacement = type;
    wrap.setAttribute("aria-label", "Advertisement");

    wrap.innerHTML =
      '<a class="blogAdCard" href="' +
      ad.href +
      '">' +
      '<span class="blogAdCard__label">Advertisement</span>' +
      '<span class="blogAdCard__title">' +
      ad.title +
      "</span>" +
      '<span class="blogAdCard__copy">' +
      ad.copy +
      "</span>" +
      '<span class="blogAdCard__cta">' +
      ad.cta +
      "</span>" +
      "</a>";

    return wrap;
  }

  function insertMobilePlacement() {
    const children = Array.from(article.children).filter((el) => {
      return !el.matches(".crumbs, h1, .blogHeroImage, [data-blog-ad-placement]");
    });
    const index = Math.max(2, Math.floor(children.length * 0.5));
    const anchor = children[index] || children[children.length - 1] || article.lastElementChild;
    const mobile = createPlacement("mobile");

    if (anchor && anchor.parentElement === article) {
      anchor.insertAdjacentElement("afterend", mobile);
    } else {
      article.appendChild(mobile);
    }
  }

  function watchMonetagRender() {
    const update = () => {
      const rendered = Array.from(document.querySelectorAll("iframe")).some((frame) => {
        const src = frame.getAttribute("src") || "";
        const box = frame.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && /monetag|inpage|jhnwr|nap5k|push/i.test(src);
      });
      document.documentElement.toggleAttribute("data-monetag-rendered", rendered);
    };

    update();
    window.setTimeout(update, 4000);
    window.setTimeout(update, 12000);
  }

  document.body.appendChild(createPlacement("desktop"));
  insertMobilePlacement();
  watchMonetagRender();
})();
