'use strict';
// Adult / porn / erotic site detection. Shared by the Anchor app (core.js) and the browser extension.
// Same rules as the Android app: well-known sites, adult-only TLDs, and conservative keyword checks.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnchorAdult = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TLDS = new Set(['xxx', 'porn', 'porno', 'sex', 'sexy', 'adult', 'sexe']);
  const DOMAINS = new Set([
    '4tube.com', 'admireme.vip', 'adultfriendfinder.com', 'adulttime.com', 'analdin.com', 'ashemaletube.com',
    'ashleymadison.com', 'asstr.org', 'avgle.com', 'babepedia.com', 'babes.com', 'bangbros.com', 'beeg.com',
    'benaughty.com', 'blacked.com', 'bongacams.com', 'brazzers.com', 'cam4.com', 'camcontacts.com', 'cams.com',
    'camsoda.com', 'camwhores.tv', 'celebjihad.com', 'chaturbate.com', 'clips4sale.com', 'coomer.su', 'daftsex.com',
    'danbooru.donmai.us', 'deeper.com', 'digitalplayground.com', 'drtuber.com', 'e-hentai.org', 'e621.net', 'efukt.com',
    'eporner.com', 'erome.com', 'evilangel.com', 'exhentai.org', 'fakehub.com', 'fakku.net', 'familystrokes.com',
    'fancentro.com', 'fansly.com', 'fapdu.com', 'fapello.com', 'fapnado.com', 'fling.com', 'flirt4free.com',
    'freeones.com', 'fuq.com', 'furaffinity.net', 'gelbooru.com', 'girlsway.com', 'gotanynudes.com', 'hanime.tv',
    'hclips.com', 'hdzog.com', 'heavy-r.com', 'hentai2read.com', 'hentaifox.com', 'hentaigasm.com', 'hentaihaven.xxx',
    'hitomi.la', 'hqporner.com', 'iafd.com', 'imlive.com', 'iwantclips.com', 'jav.guru', 'javbus.com', 'javhd.com',
    'javlibrary.com', 'javmost.com', 'jerkmate.com', 'julesjordan.com', 'justfor.fans', 'kemono.su', 'literotica.com',
    'livejasmin.com', 'loyalfans.com', 'manyvids.com', 'missav.com', 'mofos.com', 'momxxx.com', 'motherless.com',
    'myfreecams.com', 'mylf.com', 'naughtyamerica.com', 'nhentai.net', 'nhentai.to', 'nifty.org', 'nubiles.net',
    'nubilesporn.com', 'nudostar.com', 'nuvid.com', 'okxxx.com', 'onlyfans.com', 'pervmom.com', 'pichunter.com',
    'porn.com', 'porn300.com', 'porndig.com', 'porngo.com', 'pornhat.com', 'pornhub.com', 'pornktube.com', 'pornmd.com',
    'pornone.com', 'pornoxo.com', 'pornpics.com', 'pornpros.com', 'pornstarbyface.com', 'porntrex.com', 'pornwhite.com',
    'private.com', 'puretaboo.com', 'realitykings.com', 'redgifs.com', 'redtube.com', 'rule34.paheal.net', 'rule34.us',
    'rule34.xxx', 'sex.com', 'sexcom.com', 'sexstories.com', 'sexvid.xxx', 'sexyporn.tv', 'shemalez.com', 'simpcity.su',
    'simply-hentai.com', 'sislovesme.com', 'slayed.com', 'spankbang.com', 'streamate.com', 'stripchat.com',
    'sunporno.com', 'supjav.com', 'teamskeet.com', 'thisav.com', 'thothub.to', 'tnaflix.com', 'tranny.one',
    'trannytube.tv', 'tsumino.com', 'tube8.com', 'tushy.com', 'twistys.com', 'txxx.com', 'vixen.com', 'vporn.com',
    'wicked.com', 'xhamster.com', 'xhamster.desi', 'xhamster2.com', 'xhamster3.com', 'xlovecam.com', 'xmatch.com',
    'xmoviesforyou.com', 'xnxx.com', 'xnxx.health', 'xnxx.tv', 'xozilla.com', 'xtube.com', 'xvideos.com', 'xvideos2.com',
    'xvideos3.com', 'xxxbunker.com', 'xxxfiles.com', 'yespornplease.com', 'youporn.com', 'yourporn.sexy',
  ]);
  // substrings in the part before the TLD that are (almost) never innocent; "xxxl" (clothing sizes) is stripped first
  const KEYWORDS = ['porn', 'xxx', 'hentai', 'erotic', 'xvideos', 'xnxx', 'xhamster', 'redtube', 'youporn', 'camgirl', 'livesex', 'sexcam', 'sexchat', 'nudevideo', 'nakedgirl', 'fuckbook', 'pussy', 'milf', 'blowjob', 'hotwife'];
  const SAFE = ['xxxl', 'xxxlutz', 'pornography-research'];

  function isAdult(hostIn) {
    const h = String(hostIn || '').trim().replace(/\.+$/, '').toLowerCase();
    if (!h || !h.includes('.')) return false;
    const labels = h.split('.');
    if (TLDS.has(labels[labels.length - 1])) return true;
    for (let i = 0; i < labels.length; i++) if (DOMAINS.has(labels.slice(i).join('.'))) return true;
    let body = labels.slice(0, -1).join('.');
    for (const s of SAFE) body = body.split(s).join('');
    return KEYWORDS.some((k) => body.includes(k));
  }
  return { isAdult, DOMAIN_COUNT: DOMAINS.size };
});
