// "https://www.example.com/" → "example.com". For showing addresses, never for opening them.
export const prettyUrl = (url: string) =>
  url
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
