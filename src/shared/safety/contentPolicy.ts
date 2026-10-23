// What Browsie's agent won't search for or open, whoever asks: adult and sexual content. Enforced in code
// at every place the agent can go somewhere or type something (spoken requests, address-bar searches,
// page navigation, typed text), so it doesn't depend on a model saying no. Pure, so both processes use it.
//
// Word lists are matched as whole words, after folding case, accents and common letter swaps
// ("p0rn", "n*des"), so "Sussex" or "Essex" aren't caught by "sex".

// Words that are adult on their own.
const WORDS = [
  'porn', 'porno', 'pornography', 'pornographic', 'nsfw', 'xxx', 'hentai', 'rule34', 'nude', 'nudes', 'nudity',
  'naked', 'topless', 'milf', 'milfs', 'camgirl', 'camgirls', 'camwhore', 'webcamsex', 'sexcam', 'sexcams',
  'boobs', 'tits', 'titties', 'pussy', 'cumshot', 'blowjob', 'handjob', 'gangbang', 'bukkake', 'creampie',
  'deepthroat', 'anal', 'bdsm', 'fetish', 'erotic', 'erotica', 'escort', 'escorts', 'hookers', 'stripchat',
  'onlyfans', 'fansly', 'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn', 'chaturbate', 'brazzers',
  'livejasmin', 'spankbang', 'motherless',
];

// Phrases that are adult together, though each word alone is fine.
const PHRASES = [
  'sex video', 'sex videos', 'sex tape', 'sex tapes', 'sex chat', 'sex cam', 'sex cams', 'sex pics', 'sex pictures',
  'sex movie', 'sex movies', 'free sex', 'having sex', 'live sex', 'hot sex', 'sex scene', 'sex scenes',
  'adult videos', 'adult video', 'adult content', 'adult sites', 'adult site', 'dick pic', 'dick pics',
  'strip club', 'strip tease', 'striptease', 'hot girls', 'sexy girls', 'sexy women', 'girls in bikinis',
  'without clothes', 'no clothes', 'leaked pics', 'leaked nudes', 'only fans',
];

// Adult sites, matched against the host (subdomains included). Most are also in WORDS by name; this
// catches them typed as addresses.
const HOST_PARTS = [
  'pornhub', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn', 'onlyfans', 'fansly', 'chaturbate', 'brazzers',
  'livejasmin', 'stripchat', 'spankbang', 'motherless', 'porn', 'xxx', 'sex',
];
const HOST_TLDS = ['.xxx', '.porn', '.sex', '.adult'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '*': '' };

export const normalizeForPolicy = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[013457@$*]/g, (char) => LEET[char] ?? char)
    .replace(/[^a-z]+/g, ' ')
    .trim();

const WORD_SET = new Set(WORDS);
const PHRASE_LIST = PHRASES.map((phrase) => ` ${phrase} `);

// URLs: look at the decoded search words as well as the host.
const textOfUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const params = [...url.searchParams.values()].join(' ');
    return { host, text: `${decodeURIComponent(url.pathname)} ${params}` };
  } catch {
    return undefined;
  }
};

const hostIsAdult = (host: string) =>
  HOST_TLDS.some((tld) => host.endsWith(tld)) ||
  host.split('.').some((label) => HOST_PARTS.some((part) => label === part || label.startsWith(part) || label.endsWith(part)));

// True when the text (a request, a search, an address, or text to type) asks for adult content.
export const isAdultContent = (input: string) => {
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? textOfUrl(input.trim()) : undefined;
  if (url && hostIsAdult(url.host)) return true;

  const words = normalizeForPolicy(url ? url.text : input);
  if (!words) return false;
  if (words.split(' ').some((word) => WORD_SET.has(word))) return true;
  const padded = ` ${words} `;
  if (PHRASE_LIST.some((phrase) => padded.includes(phrase))) return true;

  // A bare domain typed as words ("pornhub.com" said as an address).
  if (!url && /^[\w.-]+\.[a-z]{2,}$/i.test(input.trim())) return hostIsAdult(input.trim().toLowerCase());
  return false;
};

export const ADULT_REFUSAL = "Browsie doesn't search for or open adult content.";
