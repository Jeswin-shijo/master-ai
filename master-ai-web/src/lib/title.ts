import { useEffect } from 'react';
import { NAV } from './nav';

const PRODUCT = 'ONEHUMAN OS';

/** The tab's title: the page, then the product. Printing uses it as the PDF's file name. */
export function pageTitle(page: string | undefined): string {
  return page ? `${page} · ${PRODUCT}` : PRODUCT;
}

/** A menu page's title is its menu label; other pages name themselves. */
export function navTitle(pathname: string): string | undefined {
  return NAV.find((i) => i.to === pathname)?.label;
}

export function usePageTitle(page: string | undefined) {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
