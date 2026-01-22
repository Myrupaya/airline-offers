import React, { useEffect, useState } from "react";
import axios from "axios";
import Papa from "papaparse";
import "./App.css";

/** -------------------- CONFIG -------------------- */
const LIST_FIELDS = {
  credit: ["Eligible Credit Cards", "Eligible Cards"],
  debit: ["Eligible Debit Cards", "Applicable Debit Cards"],
  title: ["Offer Title", "Title", "Offer"],
  image: ["Image", "Credit Card Image", "Offer Image", "image", "Image URL"],
  link: ["Link", "Offer Link"],
  desc: ["Description", "Details", "Offer Description", "Flight Benefit"],
  // Permanent (inbuilt) CSV fields
  permanentCCName: ["Credit Card Name"],
  permanentBenefit: ["Flight Benefit", "Benefit", "Offer", "Hotel Benefit"],
  // 🔹 Coupon fields (IndiGo + others)
  coupon: ["Coupon Code", "Coupon", "Promo Code", "Promo code", "Code"],

  // ✅ UPI / NetBanking fields
  upi: ["UPI", "Upi", "UPI Options", "UPI Method"],
  netbanking: ["NetBanking", "Net Banking", "Netbanking", "NetBanking Options"],
};

const MAX_SUGGESTIONS = 50;

/** 🔴 Names (substrings) that must NEVER appear in chip strips */
const EXCLUDED_CHIP_SUBSTRINGS = [
  "airtel transit debit card",
  "airtel virtual debit card",
];

/** Sites that should show the red per-card variant note */
const VARIANT_NOTE_SITES = new Set([
  "EaseMyTrip",
  "Yatra (Domestic)",
  "Yatra (International)",
  "Ixigo",
  "MakeMyTrip",
  "ClearTrip",
  "Goibibo",
  "Airline",
  "Permanent",
]);

/** -------------------- IMAGE FALLBACKS -------------------- */
/* Keys must be lowercase versions of the site labels you pass into wrappers */
const FALLBACK_IMAGE_BY_SITE = {
  cleartrip:
    "https://digitalscholar.in/wp-content/uploads/2022/08/Cleartrip-Digital-marketing-strategies.webp",
  easemytrip:
    "https://www.traveltrendstoday.in/storage/posts/channels4-profile-12.jpg",
  goibibo:
    "https://img-cdn.publive.online/fit-in/1200x675/filters:format(webp)/smstreet/media/media_files/oh1xyxLOe0PaiN1jF9uP.jpg",
  ixigo:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Ixigo_logo.svg/2560px-Ixigo_logo.svg.png",
  makemytrip:
    "https://d1yjjnpx0p53s8.cloudfront.net/styles/logo-thumbnail/s3/112019/mmt_fullcolor.png?JgFR3clMwpXRH2xztnw10uhf0tUSghgS&itok=2eLs41rV",
  "yatra (domestic)":
    "https://play-lh.googleusercontent.com/6ACvwZruB53DwP81U-vwvBob0rgMR1NxwyocN-g5Ey72k1HWbz9FmNuiMxPte4N8SQ",
  "yatra (international)":
    "https://play-lh.googleusercontent.com/6ACvwZruB53DwP81U-vwvBob0rgMR1NxwyocN-g5Ey72k1HWbz9FmNuiMxPte4N8SQ",
  indigo:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/IndiGo_Logo.svg/2560px-IndiGo_Logo.svg.png",
  "air india":
    "https://upload.wikimedia.org/wikipedia/en/1/1e/Air_India_Logo.svg", // fallback for Air India
};

/** Helpers to decide usable image & resolve fallback */
function isUsableImage(val) {
  if (!val) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (/^(na|n\/a|null|undefined|-|image unavailable)$/i.test(s)) return false;
  return true;
}
function resolveImage(siteKey, candidate) {
  const key = String(siteKey || "").toLowerCase();
  const fallback = FALLBACK_IMAGE_BY_SITE[key];
  const usingFallback = !isUsableImage(candidate) && !!fallback;
  return {
    src: usingFallback ? fallback : candidate,
    usingFallback,
  };
}
/** If network fails, swap to fallback and tag class for CSS */
function handleImgError(e, siteKey) {
  const key = String(siteKey || "").toLowerCase();
  const fallback = FALLBACK_IMAGE_BY_SITE[key];
  const el = e.currentTarget;
  if (fallback && el.src !== fallback) {
    el.src = fallback;
    el.classList.add("is-fallback");
  } else {
    el.style.display = "none"; // hide entirely if even fallback fails
  }
}

/** -------------------- TEXT HELPERS -------------------- */
const toNorm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function firstField(obj, keys) {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] !== undefined &&
      obj[k] !== null &&
      String(obj[k]).trim() !== ""
    ) {
      return obj[k];
    }
  }
  return undefined;
}

function splitList(val) {
  if (!val) return [];
  return String(val)
    .replace(/\n/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getBase(name) {
  if (!name) return "";
  return String(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function getVariant(name) {
  if (!name) return "";
  const m = String(name).match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}
function brandCanonicalize(text) {
  let s = String(text || "");
  s = s.replace(/\bMakemytrip\b/gi, "MakeMyTrip");
  s = s.replace(/\bIcici\b/gi, "ICICI");
  s = s.replace(/\bHdfc\b/gi, "HDFC");
  s = s.replace(/\bSbi\b/gi, "SBI");
  s = s.replace(/\bIdfc\b/gi, "IDFC");
  s = s.replace(/\bPnb\b/gi, "PNB");
  s = s.replace(/\bRbl\b/gi, "RBL");
  s = s.replace(/\bYes\b/gi, "YES");
  return s;
}

/** Fuzzy scoring */
function lev(a, b) {
  a = toNorm(a);
  b = toNorm(b);
  const n = a.length,
    m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[n][m];
}
function scoreCandidate(q, cand) {
  const qs = toNorm(q);
  const cs = toNorm(cand);
  if (!qs) return 0;
  if (cs.includes(qs)) return 100;
  const qWords = qs.split(" ").filter(Boolean);
  const cWords = cs.split(" ").filter(Boolean);
  const matchingWords = qWords.filter((qw) => cWords.some((cw) => cw.includes(qw)))
    .length;
  const sim = 1 - lev(qs, cs) / Math.max(qs.length, cs.length);
  return (matchingWords / Math.max(1, qWords.length)) * 0.7 + sim * 0.3;
}

/** Dropdown entry builder */
function makeEntry(raw, type) {
  const base = brandCanonicalize(getBase(raw));
  return { type, display: base, baseNorm: toNorm(base) };
}

function normalizeUrl(u) {
  if (!u) return "";
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}
function normalizeText(s) {
  return toNorm(s || "");
}
function offerKey(offer) {
  const image = normalizeUrl(firstField(offer, LIST_FIELDS.image) || "");
  const title = normalizeText(firstField(offer, LIST_FIELDS.title) || offer.Website || "");
  const desc = normalizeText(firstField(offer, LIST_FIELDS.desc) || "");
  const link = normalizeUrl(firstField(offer, LIST_FIELDS.link) || "");
  return `${title}||${desc}||${image}||${link}`;
}

function dedupWrappers(arr, seen) {
  const out = [];
  for (const w of arr || []) {
    const k = offerKey(w.offer);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/** Helper: is a cell meaningful for offer/benefit? */
function isMeaningful(val) {
  if (!val) return false;
  const s = String(val).trim();
  if (!s) return false;
  if (/^(na|n\/a|null|undefined|-|--|none)$/i.test(s)) return false;
  return true;
}

/** 🔹 Row-level check: does this CSV row actually have an active/real offer? */
function rowHasOffer(row, { permanent = false } = {}) {
  if (!row) return false;

  const desc = firstField(row, LIST_FIELDS.desc);
  const title = firstField(row, LIST_FIELDS.title);
  const link = firstField(row, LIST_FIELDS.link);
  const benefit = permanent ? firstField(row, LIST_FIELDS.permanentBenefit) : undefined;

  if (isMeaningful(desc)) return true;
  if (isMeaningful(title)) return true;
  if (isMeaningful(link)) return true;
  if (permanent && isMeaningful(benefit)) return true;

  return false;
}

/** 🔹 Fuzzy detection for "select" (handles "selct", "selet", "slect", etc.) */
function hasSelectLikeWord(text) {
  const qs = toNorm(text);
  if (!qs) return false;
  const words = qs.split(" ").filter(Boolean);
  for (const w of words) {
    if (w === "select") return true;
    // allow small typos: distance <= 2
    if (lev(w, "select") <= 2) return true;
  }
  return false;
}

/** 🔹 Check if a chip name should be excluded (substring match, normalized) */
function isExcludedChipName(name) {
  const norm = toNorm(name);
  if (!norm) return false;
  return EXCLUDED_CHIP_SUBSTRINGS.some((sub) => norm.includes(sub));
}

/** Disclaimer */
const Disclaimer = () => (
  <section className="disclaimer">
    <h3>Disclaimer</h3>
    <p>
      All offers, coupons, and discounts listed on our platform are provided for informational
      purposes only. We do not guarantee the accuracy, availability, or validity of any offer.
      Users are advised to verify the terms and conditions with the respective merchants before
      making any purchase. We are not responsible for any discrepancies, expired offers, or
      losses arising from the use of these coupons.
    </p>
  </section>
);

/** -------------------- COMPONENT -------------------- */
const AirlineOffers = () => {
  // dropdown data (from allCards.csv ONLY)
  const [creditEntries, setCreditEntries] = useState([]);
  const [debitEntries, setDebitEntries] = useState([]);
  const [upiEntries, setUpiEntries] = useState([]);
  const [netbankingEntries, setNetbankingEntries] = useState([]);

  // chip strips (from offer CSVs ONLY)
  const [chipCC, setChipCC] = useState([]);
  const [chipDC, setChipDC] = useState([]);
  const [chipUPI, setChipUPI] = useState([]);
  const [chipNB, setChipNB] = useState([]);

  // ui state
  const [filteredCards, setFilteredCards] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null); // {type, display, baseNorm}
  const [noMatches, setNoMatches] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // offers
  const [easeOffers, setEaseOffers] = useState([]);
  const [yatraDomesticOffers, setYatraDomesticOffers] = useState([]);
  const [yatraInternationalOffers, setYatraInternationalOffers] = useState([]);
  const [ixigoOffers, setIxigoOffers] = useState([]);
  const [airlineOffers, setAirlineOffers] = useState([]);
  const [makeMyTripOffers, setMakeMyTripOffers] = useState([]);
  const [clearTripOffers, setClearTripOffers] = useState([]);
  const [goibiboOffers, setGoibiboOffers] = useState([]);
  const [permanentOffers, setPermanentOffers] = useState([]);
  const [indigoOffers, setIndigoOffers] = useState([]); // IndiGo
  const [airIndiaOffers, setAirIndiaOffers] = useState([]); // Air India

  // responsive
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 1) Load allCards.csv for dropdown lists ONLY
  useEffect(() => {
    async function loadAllCards() {
      try {
        const res = await axios.get(`/allCards.csv`);
        const parsed = Papa.parse(res.data, { header: true });
        const rows = parsed.data || [];

        const creditMap = new Map();
        const debitMap = new Map();
        const upiMap = new Map();
        const nbMap = new Map();

        for (const row of rows) {
          const ccList = splitList(firstField(row, LIST_FIELDS.credit));
          for (const raw of ccList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) creditMap.set(baseNorm, creditMap.get(baseNorm) || base);
          }
          const dcList = splitList(firstField(row, LIST_FIELDS.debit));
          for (const raw of dcList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) debitMap.set(baseNorm, debitMap.get(baseNorm) || base);
          }

          // UPI / NetBanking if present in allCards.csv
          const upiList = splitList(firstField(row, LIST_FIELDS.upi));
          for (const raw of upiList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) upiMap.set(baseNorm, upiMap.get(baseNorm) || base);
          }
          const nbList = splitList(firstField(row, LIST_FIELDS.netbanking));
          for (const raw of nbList) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) nbMap.set(baseNorm, nbMap.get(baseNorm) || base);
          }
        }

        const credit = Array.from(creditMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "credit"));
        const debit = Array.from(debitMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "debit"));
        const upi = Array.from(upiMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "upi"));
        const netbanking = Array.from(nbMap.values())
          .sort((a, b) => a.localeCompare(b))
          .map((d) => makeEntry(d, "netbanking"));

        setCreditEntries(credit);
        setDebitEntries(debit);
        setUpiEntries(upi);
        setNetbankingEntries(netbanking);

        setFilteredCards([
          ...(credit.length ? [{ type: "heading", label: "Credit Cards" }] : []),
          ...credit,
          ...(debit.length ? [{ type: "heading", label: "Debit Cards" }] : []),
          ...debit,
          ...(upi.length ? [{ type: "heading", label: "UPI" }] : []),
          ...upi,
          ...(netbanking.length ? [{ type: "heading", label: "NetBanking" }] : []),
          ...netbanking,
        ]);

        if (!credit.length && !debit.length && !upi.length && !netbanking.length) {
          setNoMatches(true);
          setSelected(null);
        }
      } catch (e) {
        console.error("allCards.csv load error:", e);
        setNoMatches(true);
        setSelected(null);
      }
    }
    loadAllCards();
  }, []);

  // 2) Load all offer CSVs
  useEffect(() => {
    async function loadOffers() {
      try {
        const files = [
          { name: "easeMyTrip.csv", setter: setEaseOffers },
          { name: "yatraDomestic.csv", setter: setYatraDomesticOffers },
          { name: "yatraInternational.csv", setter: setYatraInternationalOffers },
          { name: "ixigo.csv", setter: setIxigoOffers },
          { name: "airline.csv", setter: setAirlineOffers },
          { name: "makemytrip.csv", setter: setMakeMyTripOffers },
          { name: "cleartrip.csv", setter: setClearTripOffers },
          { name: "goibibo.csv", setter: setGoibiboOffers },
          { name: "permanent.csv", setter: setPermanentOffers },
          { name: "indigo.csv", setter: setIndigoOffers },
          { name: "airindia.csv", setter: setAirIndiaOffers },
        ];

        await Promise.all(
          files.map(async (f) => {
            const res = await axios.get(`/${encodeURIComponent(f.name)}`);
            const parsed = Papa.parse(res.data, { header: true });
            f.setter(parsed.data || []);
          })
        );
      } catch (e) {
        console.error("Offer CSV load error:", e);
      }
    }
    loadOffers();
  }, []);

  // ✅ NEW: Ensure dropdown has UPI / NetBanking entries even if allCards.csv doesn’t include them
  useEffect(() => {
    const upiMap = new Map();
    const nbMap = new Map();

    const harvest = (rows) => {
      for (const o of rows || []) {
        if (!rowHasOffer(o)) continue;

        const upiField = firstField(o, LIST_FIELDS.upi);
        if (upiField) {
          for (const raw of splitList(upiField)) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) upiMap.set(baseNorm, upiMap.get(baseNorm) || base);
          }
        }

        const nbField = firstField(o, LIST_FIELDS.netbanking);
        if (nbField) {
          for (const raw of splitList(nbField)) {
            const base = brandCanonicalize(getBase(raw));
            const baseNorm = toNorm(base);
            if (baseNorm) nbMap.set(baseNorm, nbMap.get(baseNorm) || base);
          }
        }
      }
    };

    harvest(easeOffers);
    harvest(yatraDomesticOffers);
    harvest(yatraInternationalOffers);
    harvest(ixigoOffers);
    harvest(airlineOffers);
    harvest(makeMyTripOffers);
    harvest(clearTripOffers);
    harvest(goibiboOffers);
    harvest(indigoOffers);
    harvest(airIndiaOffers);

    const upiFromOffers = Array.from(upiMap.values())
      .sort((a, b) => a.localeCompare(b))
      .map((d) => makeEntry(d, "upi"));

    const nbFromOffers = Array.from(nbMap.values())
      .sort((a, b) => a.localeCompare(b))
      .map((d) => makeEntry(d, "netbanking"));

    setUpiEntries((prev) => {
      const m = new Map();
      (prev || []).forEach((e) => {
        if (e && e.baseNorm) m.set(e.baseNorm, e);
      });
      (upiFromOffers || []).forEach((e) => {
        if (e && e.baseNorm && !m.has(e.baseNorm)) m.set(e.baseNorm, e);
      });
      return Array.from(m.values()).sort((a, b) => a.display.localeCompare(b.display));
    });

    setNetbankingEntries((prev) => {
      const m = new Map();
      (prev || []).forEach((e) => {
        if (e && e.baseNorm) m.set(e.baseNorm, e);
      });
      (nbFromOffers || []).forEach((e) => {
        if (e && e.baseNorm && !m.has(e.baseNorm)) m.set(e.baseNorm, e);
      });
      return Array.from(m.values()).sort((a, b) => a.display.localeCompare(b.display));
    });
  }, [
    easeOffers,
    yatraDomesticOffers,
    yatraInternationalOffers,
    ixigoOffers,
    airlineOffers,
    makeMyTripOffers,
    clearTripOffers,
    goibiboOffers,
    indigoOffers,
    airIndiaOffers,
  ]);

  /** Build chip strips from OFFER CSVs (exclude allCards.csv) */
  useEffect(() => {
    const ccMap = new Map(); // baseNorm -> display
    const dcMap = new Map();
    const upiMap = new Map();
    const nbMap = new Map();

    const harvestList = (val, targetMap, { excludeChipNames = false } = {}) => {
      for (const raw of splitList(val)) {
        const base = brandCanonicalize(getBase(raw));
        const baseNorm = toNorm(base);
        if (!baseNorm) continue;

        // 🚫 Exclude Airtel Transit / Airtel Virtual Debit Card (even with suffixes)
        if (excludeChipNames && isExcludedChipName(base)) continue;

        targetMap.set(baseNorm, targetMap.get(baseNorm) || base);
      }
    };

    const harvestRows = (
      rows,
      {
        permanent = false,
        includeCredit = true,
        includeDebit = true,
        includeUPI = true,
        includeNetBanking = true,
      } = {}
    ) => {
      for (const o of rows || []) {
        // ✅ Only consider rows that actually have a meaningful offer/benefit
        if (!rowHasOffer(o, { permanent })) continue;

        if (includeCredit) {
          const ccField = firstField(o, LIST_FIELDS.credit);
          if (ccField) harvestList(ccField, ccMap, { excludeChipNames: true });
        }

        if (includeDebit) {
          const dcField = firstField(o, LIST_FIELDS.debit);
          if (dcField) harvestList(dcField, dcMap, { excludeChipNames: true });
        }

        if (includeUPI) {
          const upiField = firstField(o, LIST_FIELDS.upi);
          if (upiField) harvestList(upiField, upiMap, { excludeChipNames: false });
        }

        if (includeNetBanking) {
          const nbField = firstField(o, LIST_FIELDS.netbanking);
          if (nbField) harvestList(nbField, nbMap, { excludeChipNames: false });
        }
      }
    };

    // Provider files → credit + debit + UPI + NetBanking (only rows with real offers)
    harvestRows(easeOffers);
    harvestRows(yatraDomesticOffers);
    harvestRows(yatraInternationalOffers);
    harvestRows(ixigoOffers);
    harvestRows(airlineOffers);
    harvestRows(makeMyTripOffers);
    harvestRows(clearTripOffers);
    harvestRows(goibiboOffers);
    harvestRows(indigoOffers);
    harvestRows(airIndiaOffers);

    // Permanent credit cards (credit only, only if permanent benefit/offer is real)
    harvestRows(permanentOffers, {
      permanent: true,
      includeCredit: true,
      includeDebit: false,
      includeUPI: false,
      includeNetBanking: false,
    });

    let creditChipList = Array.from(ccMap.values()).sort((a, b) => a.localeCompare(b));
    let debitChipList = Array.from(dcMap.values()).sort((a, b) => a.localeCompare(b));
    let upiChipList = Array.from(upiMap.values()).sort((a, b) => a.localeCompare(b));
    let nbChipList = Array.from(nbMap.values()).sort((a, b) => a.localeCompare(b));

    // Extra safety filter again on final lists
    creditChipList = creditChipList.filter((name) => !isExcludedChipName(name));
    debitChipList = debitChipList.filter((name) => !isExcludedChipName(name));

    setChipCC(creditChipList);
    setChipDC(debitChipList);
    setChipUPI(upiChipList);
    setChipNB(nbChipList);
  }, [
    easeOffers,
    yatraDomesticOffers,
    yatraInternationalOffers,
    ixigoOffers,
    airlineOffers,
    makeMyTripOffers,
    clearTripOffers,
    goibiboOffers,
    permanentOffers,
    indigoOffers,
    airIndiaOffers,
  ]);

  /** 🔹 search box with fuzzy "select" handling */
  const onChangeQuery = (e) => {
    const val = e.target.value;
    setQuery(val);

    const trimmed = val.trim();
    if (!trimmed) {
      setFilteredCards([]);
      setSelected(null);
      setNoMatches(false);
      return;
    }

    const qLower = trimmed.toLowerCase();
    const qNorm = toNorm(trimmed);
    const queryHasSelectLike = hasSelectLikeWord(trimmed);

    const scored = (arr) =>
      arr
        .map((it) => {
          const s = scoreCandidate(trimmed, it.display);
          const labelNorm = toNorm(it.display);
          const inc = labelNorm.includes(qNorm);

          // does this card label itself contain "select" word (Axis Select, HDFC Select Credit Card, etc.)
          const labelWords = labelNorm.split(" ").filter(Boolean);
          const labelHasSelectWord = labelWords.some(
            (w) => w === "select" || lev(w, "select") <= 1
          );

          const passesFuzzySelect = queryHasSelectLike && labelHasSelectWord;

          return { it, s, inc, passesFuzzySelect, labelNorm };
        })
        // Keep if normal match OR fuzzy select match
        .filter(({ s, inc, passesFuzzySelect }) => inc || s > 0.3 || passesFuzzySelect)
        .sort((a, b) => b.s - a.s || a.it.display.localeCompare(b.it.display))
        .slice(0, MAX_SUGGESTIONS)
        .map(({ it }) => it);

    // ✅ keyword detection for UPI / NetBanking
    const mentionsUPI = qNorm === "upi" || /\bupi\b/i.test(trimmed);
    const mentionsNetBanking =
      qNorm === "netbanking" ||
      qNorm === "net banking" ||
      /net\s*bank/i.test(trimmed);

    // If user types ONLY "upi" / "netbanking" -> show ALL of those entries at top
    const upiList =
      qNorm === "upi"
        ? (upiEntries || []).slice(0, MAX_SUGGESTIONS)
        : scored(upiEntries || []);
    const nbList =
      qNorm === "netbanking" || qNorm === "net banking"
        ? (netbankingEntries || []).slice(0, MAX_SUGGESTIONS)
        : scored(netbankingEntries || []);

    let cc = scored(creditEntries || []);
    let dc = scored(debitEntries || []);

    if (!cc.length && !dc.length && !upiList.length && !nbList.length) {
      setNoMatches(true);
      setSelected(null);
      setFilteredCards([]);
      return;
    }

    setNoMatches(false);

    // 🔹 If query looks like "select"/"selct"/etc → push all Select cards to top
    if (queryHasSelectLike) {
      const bumpSelectCards = (arr) => {
        const selectOnTop = [];
        const rest = [];
        arr.forEach((item) => {
          const norm = toNorm(item.display);
          const words = norm.split(" ").filter(Boolean);
          const hasSelectWord = words.some(
            (w) => w === "select" || lev(w, "select") <= 1
          );
          if (hasSelectWord) selectOnTop.push(item);
          else rest.push(item);
        });
        return [...selectOnTop, ...rest];
      };
      cc = bumpSelectCards(cc);
      dc = bumpSelectCards(dc);
    }

    /** --- SPECIAL CASE: query mentions dc / debit / debit card → debit first --- */
    const mentionsDebit =
      qLower.includes("debit card") ||
      qLower.includes("debit") ||
      qLower.includes(" dc") ||
      qLower.startsWith("dc ") ||
      qLower.endsWith(" dc") ||
      qLower === "dc";

    const buildList = (order) => {
      const out = [];
      for (const sec of order) {
        if (sec === "upi" && upiList.length) out.push({ type: "heading", label: "UPI" }, ...upiList);
        if (sec === "netbanking" && nbList.length)
          out.push({ type: "heading", label: "NetBanking" }, ...nbList);
        if (sec === "credit" && cc.length)
          out.push({ type: "heading", label: "Credit Cards" }, ...cc);
        if (sec === "debit" && dc.length)
          out.push({ type: "heading", label: "Debit Cards" }, ...dc);
      }
      return out;
    };

    // If query indicates NetBanking / UPI, show those sections at TOP
    if (mentionsNetBanking) {
      setFilteredCards(buildList(["netbanking", "upi", "credit", "debit"]));
      return;
    }
    if (mentionsUPI) {
      setFilteredCards(buildList(["upi", "netbanking", "credit", "debit"]));
      return;
    }

    if (mentionsDebit) {
      setFilteredCards(buildList(["debit", "credit", "upi", "netbanking"]));
    } else {
      setFilteredCards(buildList(["credit", "debit", "upi", "netbanking"]));
    }
  };

  const onPick = (entry) => {
    setSelected(entry);
    setQuery(entry.display);
    setFilteredCards([]);
    setNoMatches(false);
  };

  // Chip click → set the dropdown + selected entry
  const handleChipClick = (name, type) => {
    const display = brandCanonicalize(getBase(name));
    const baseNorm = toNorm(display);
    setQuery(display);
    setSelected({ type, display, baseNorm });
    setFilteredCards([]);
    setNoMatches(false);
  };

  /** Build matches for one CSV: return wrappers {offer, site, variantText} */
  function matchesFor(offers, type, site) {
    if (!selected) return [];
    const out = [];
    for (const o of offers || []) {
      let list = [];

      if (type === "permanent") {
        const nm = firstField(o, LIST_FIELDS.permanentCCName);
        if (nm) list = [nm];
      } else if (type === "upi") {
        list = splitList(firstField(o, LIST_FIELDS.upi));
      } else if (type === "netbanking") {
        list = splitList(firstField(o, LIST_FIELDS.netbanking));
      } else if (type === "debit") {
        list = splitList(firstField(o, LIST_FIELDS.debit));
      } else {
        list = splitList(firstField(o, LIST_FIELDS.credit));
      }

      let matched = false;
      let matchedVariant = "";
      for (const raw of list) {
        const base = brandCanonicalize(getBase(raw));
        if (toNorm(base) === selected.baseNorm) {
          matched = true;
          const v = getVariant(raw);
          if (v) matchedVariant = v;
          break;
        }
      }
      if (matched) out.push({ offer: o, site, variantText: matchedVariant });
    }
    return out;
  }

  const selectedMatchType =
    selected?.type === "debit"
      ? "debit"
      : selected?.type === "upi"
      ? "upi"
      : selected?.type === "netbanking"
      ? "netbanking"
      : "credit";

  // Collect then global-dedup by priority
  const wPermanent = matchesFor(permanentOffers, "permanent", "Permanent");
  const wAirline = matchesFor(airlineOffers, selectedMatchType, "Airline");
  const wGoibibo = matchesFor(goibiboOffers, selectedMatchType, "Goibibo");
  const wEase = matchesFor(easeOffers, selectedMatchType, "EaseMyTrip");
  const wYDom = matchesFor(yatraDomesticOffers, selectedMatchType, "Yatra (Domestic)");
  const wYInt = matchesFor(
    yatraInternationalOffers,
    selectedMatchType,
    "Yatra (International)"
  );
  const wIxigo = matchesFor(ixigoOffers, selectedMatchType, "Ixigo");
  const wMMT = matchesFor(makeMyTripOffers, selectedMatchType, "MakeMyTrip");
  const wCT = matchesFor(clearTripOffers, selectedMatchType, "ClearTrip");
  const wIndiGo = matchesFor(indigoOffers, selectedMatchType, "IndiGo");
  const wAirIndia = matchesFor(airIndiaOffers, selectedMatchType, "Air India");

  const seen = new Set();
  const dPermanent = selected?.type === "credit" ? dedupWrappers(wPermanent, seen) : []; // permanent for credit only
  const dAirline = dedupWrappers(wAirline, seen);
  const dGoibibo = dedupWrappers(wGoibibo, seen);
  const dEase = dedupWrappers(wEase, seen);
  const dYDom = dedupWrappers(wYDom, seen);
  const dYInt = dedupWrappers(wYInt, seen);
  const dIxigo = dedupWrappers(wIxigo, seen);
  const dMMT = dedupWrappers(wMMT, seen);
  const dCT = dedupWrappers(wCT, seen);
  const dIndiGo = dedupWrappers(wIndiGo, seen);
  const dAirIndia = dedupWrappers(wAirIndia, seen);

  const hasAny = Boolean(
    dPermanent.length ||
      dAirline.length ||
      dGoibibo.length ||
      dEase.length ||
      dYDom.length ||
      dYInt.length ||
      dIxigo.length ||
      dMMT.length ||
      dCT.length ||
      dIndiGo.length ||
      dAirIndia.length
  );

  const sectionHeading = (siteLabel, defaultHeading) => {
    if (selected?.type === "upi") return `UPI offers on ${siteLabel}`;
    if (selected?.type === "netbanking") return `NetBanking offers on ${siteLabel}`;
    return defaultHeading;
  };

  /** Offer card UI */
  const OfferCard = ({ wrapper, isPermanent }) => {
    const o = wrapper.offer;
    const title = firstField(o, LIST_FIELDS.title) || o.Website || "Offer";
    const candidateImage = firstField(o, LIST_FIELDS.image);
    const desc = firstField(o, LIST_FIELDS.desc);
    const link = firstField(o, LIST_FIELDS.link);
    const coupon = firstField(o, LIST_FIELDS.coupon);
    const couponClean = coupon && String(coupon).trim();

    const showVariantNote =
      VARIANT_NOTE_SITES.has(wrapper.site) &&
      wrapper.variantText &&
      wrapper.variantText.trim().length > 0;

    const permanentBenefit = isPermanent ? firstField(o, LIST_FIELDS.permanentBenefit) : "";

    // Resolve image (offer image or fallback logo)
    const siteKey = String(wrapper.site || "").toLowerCase();
    const { src: imgSrc, usingFallback } = resolveImage(siteKey, candidateImage);

    const descBoxStyle = {
      maxHeight: "140px",
      overflowY: "auto",
      paddingRight: "4px",
      marginBottom: "6px",
      lineHeight: 1.4,
    };

    const handleCopyCoupon = () => {
      if (!couponClean) return;
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(couponClean);
        } else {
          // fallback for older browsers
          const textarea = document.createElement("textarea");
          textarea.value = couponClean;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
      } catch (err) {
        console.error("Failed to copy coupon code:", err);
      }
    };

    return (
      <div className="offer-card">
        {imgSrc && (
          <img
            className={`offer-img ${usingFallback ? "is-fallback" : ""}`}
            src={imgSrc}
            alt={title}
            onError={(e) => handleImgError(e, siteKey)}
          />
        )}
        <div className="offer-info">
          <h3 className="offer-title">{title}</h3>

          {isPermanent ? (
            <>
              {permanentBenefit && (
                <div className="offer-desc" style={descBoxStyle}>
                  {permanentBenefit}
                </div>
              )}
              <p className="inbuilt-note">
                <strong>This is a inbuilt feature of this credit card</strong>
              </p>
            </>
          ) : (
            desc && (
              <div className="offer-desc" style={descBoxStyle}>
                {desc}
              </div>
            )
          )}

          {couponClean && (
            <div
              className="coupon-wrap"
              style={{
                marginTop: 6,
                marginBottom: 4,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontWeight: 600 }}>Coupon:</span>
              <button
                type="button"
                onClick={handleCopyCoupon}
                title="Click to copy coupon code"
                style={{
                  padding: "4px 10px",
                  borderRadius: 9999,
                  border: "1px dashed #1e7145",
                  background: "#E8F5E9",
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontSize: 14,
                  letterSpacing: 1,
                }}
              >
                {couponClean}
              </button>
            </div>
          )}

          {showVariantNote && (
            <p className="network-note">
              <strong>Note:</strong> This benefit is applicable only on{" "}
              <em>{wrapper.variantText}</em> variant
            </p>
          )}

          {link && (
            <button className="btn" onClick={() => window.open(link, "_blank")}>
              View Offer
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="App" style={{ fontFamily: "'Libre Baskerville', serif" }}>
      {(chipCC.length > 0 || chipDC.length > 0 || chipUPI.length > 0 || chipNB.length > 0) && (
        <div
          style={{
            maxWidth: 1200,
            margin: "14px auto 0",
            padding: "14px 16px",
            background: "#F7F9FC",
            border: "1px solid #E8EDF3",
            borderRadius: 10,
            boxShadow: "0 6px 18px rgba(15,23,42,.06)",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 16,
              color: "#1F2D45",
              marginBottom: 10,
              display: "flex",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span>Credit, Debit, UPI And NetBanking Options Which Have Offers</span>
          </div>

          {/* Credit strip */}
          {chipCC.length > 0 && (
            <marquee
              direction="left"
              scrollAmount="4"
              style={{ marginBottom: 8, whiteSpace: "nowrap" }}
            >
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>Credit Cards:</strong>
              {chipCC.map((name, idx) => (
                <span
                  key={`cc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "credit")}
                  onKeyDown={(e) =>
                    e.key === "Enter" ? handleChipClick(name, "credit") : null
                  }
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}

          {/* Debit strip */}
          {chipDC.length > 0 && (
            <marquee direction="left" scrollAmount="4" style={{ marginBottom: 8, whiteSpace: "nowrap" }}>
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>Debit Cards:</strong>
              {chipDC.map((name, idx) => (
                <span
                  key={`dc-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "debit")}
                  onKeyDown={(e) =>
                    e.key === "Enter" ? handleChipClick(name, "debit") : null
                  }
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this card"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}

          {/* UPI strip */}
          {chipUPI.length > 0 && (
            <marquee direction="left" scrollAmount="4" style={{ marginBottom: 8, whiteSpace: "nowrap" }}>
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>UPI:</strong>
              {chipUPI.map((name, idx) => (
                <span
                  key={`upi-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "upi")}
                  onKeyDown={(e) => (e.key === "Enter" ? handleChipClick(name, "upi") : null)}
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this UPI option"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}

          {/* NetBanking strip */}
          {chipNB.length > 0 && (
            <marquee direction="left" scrollAmount="4" style={{ whiteSpace: "nowrap" }}>
              <strong style={{ marginRight: 10, color: "#1F2D45" }}>NetBanking:</strong>
              {chipNB.map((name, idx) => (
                <span
                  key={`nb-chip-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleChipClick(name, "netbanking")}
                  onKeyDown={(e) =>
                    e.key === "Enter" ? handleChipClick(name, "netbanking") : null
                  }
                  style={{
                    display: "inline-block",
                    padding: "6px 10px",
                    border: "1px solid #E0E6EE",
                    borderRadius: 9999,
                    marginRight: 8,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1.2,
                    userSelect: "none",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#F0F5FF")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                  title="Click to select this NetBanking option"
                >
                  {name}
                </span>
              ))}
            </marquee>
          )}
        </div>
      )}

      {/* Search / dropdown */}
      <div
        className="dropdown"
        style={{ position: "relative", width: "600px", margin: "20px auto" }}
      >
        <input
          type="text"
          value={query}
          onChange={onChangeQuery}
          placeholder="Type a Credit or Debit Card...."
          className="dropdown-input"
          style={{
            width: "100%",
            padding: "12px",
            fontSize: "16px",
            border: `1px solid ${noMatches ? "#d32f2f" : "#ccc"}`,
            borderRadius: "6px",
          }}
        />
        {query.trim() && !!filteredCards.length && (
          <ul
            className="dropdown-list"
            style={{
              listStyle: "none",
              padding: "10px",
              margin: 0,
              width: "100%",
              maxHeight: "260px",
              overflowY: "auto",
              border: "1px solid #ccc",
              borderRadius: "6px",
              backgroundColor: "#fff",
              position: "absolute",
              zIndex: 1000,
            }}
          >
            {filteredCards.map((item, idx) =>
              item.type === "heading" ? (
                <li
                  key={`h-${idx}`}
                  style={{ padding: "8px 10px", fontWeight: 700, background: "#fafafa" }}
                >
                  {item.label}
                </li>
              ) : (
                <li
                  key={`i-${idx}-${item.display}`}
                  onClick={() => onPick(item)}
                  style={{
                    padding: "10px",
                    cursor: "pointer",
                    borderBottom: "1px solid #f2f2f2",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#f7f9ff")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {item.display}
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {noMatches && query.trim() && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 8 }}>
          No matching cards found. Please try a different name.
        </p>
      )}

      {/* Offers by section */}
      {selected && hasAny && !noMatches && (
        <div className="offers-section" style={{ maxWidth: 1200, margin: "0 auto", padding: 20 }}>
          {!!dPermanent.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>Permanent Offers</h2>
              <div className="offer-grid">
                {dPermanent.map((w, i) => (
                  <OfferCard key={`perm-${i}`} wrapper={w} isPermanent />
                ))}
              </div>
            </div>
          )}

          {!!dAirline.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>{sectionHeading("Airline", "Airline Offers")}</h2>
              <div className="offer-grid">
                {dAirline.map((w, i) => (
                  <OfferCard key={`air-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dGoibibo.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>{sectionHeading("Goibibo", "Offers on Goibibo")}</h2>
              <div className="offer-grid">
                {dGoibibo.map((w, i) => (
                  <OfferCard key={`go-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dEase.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>{sectionHeading("EaseMyTrip", "Offers on EaseMyTrip")}</h2>
              <div className="offer-grid">
                {dEase.map((w, i) => (
                  <OfferCard key={`emt-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dYDom.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>
                {sectionHeading("Yatra (Domestic)", "Offers on Yatra (Domestic)")}
              </h2>
              <div className="offer-grid">
                {dYDom.map((w, i) => (
                  <OfferCard key={`yd-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dYInt.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>
                {sectionHeading("Yatra (International)", "Offers on Yatra (International)")}
              </h2>
              <div className="offer-grid">
                {dYInt.map((w, i) => (
                  <OfferCard key={`yi-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dIxigo.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>{sectionHeading("Ixigo", "Offers on Ixigo")}</h2>
              <div className="offer-grid">
                {dIxigo.map((w, i) => (
                  <OfferCard key={`ix-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dMMT.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>
                {sectionHeading("MakeMyTrip", "Offers on MakeMyTrip")}
              </h2>
              <div className="offer-grid">
                {dMMT.map((w, i) => (
                  <OfferCard key={`mmt-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dCT.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>{sectionHeading("ClearTrip", "Offers on ClearTrip")}</h2>
              <div className="offer-grid">
                {dCT.map((w, i) => (
                  <OfferCard key={`ct-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dIndiGo.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>{sectionHeading("IndiGo", "Offers on IndiGo")}</h2>
              <div className="offer-grid">
                {dIndiGo.map((w, i) => (
                  <OfferCard key={`indigo-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}

          {!!dAirIndia.length && (
            <div className="offer-group">
              <h2 style={{ textAlign: "center" }}>{sectionHeading("Air India", "Offers on Air India")}</h2>
              <div className="offer-grid">
                {dAirIndia.map((w, i) => (
                  <OfferCard key={`airindia-${i}`} wrapper={w} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selected && !hasAny && !noMatches && (
        <p style={{ color: "#d32f2f", textAlign: "center", marginTop: 10 }}>
          No offer available for this card
        </p>
      )}

      {selected && hasAny && !noMatches && (
        <button
          onClick={() => window.scrollBy({ top: window.innerHeight, behavior: "smooth" })}
          style={{
            position: "fixed",
            right: 20,
            bottom: isMobile ? 20 : 150,
            padding: isMobile ? "12px 15px" : "10px 20px",
            backgroundColor: "#1e7145",
            color: "white",
            border: "none",
            borderRadius: isMobile ? "50%" : 8,
            cursor: "pointer",
            fontSize: 18,
            zIndex: 1000,
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
            width: isMobile ? 50 : 140,
            height: isMobile ? 50 : 50,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isMobile ? "↓" : "Scroll Down"}
        </button>
      )}

      <Disclaimer />
    </div>
  );
};

export default AirlineOffers;
