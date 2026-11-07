import { test } from "node:test";
import assert from "node:assert/strict";
import { prefilter, parseList } from "../lib/filters.ts";
import { containsWords, guessContract, htmlToText, norm } from "../lib/text.ts";
import { DEFAULT_FILTERS, type RawJob } from "../lib/types.ts";
import { parseFranceTravail } from "../lib/sources/francetravail.ts";
import { parseAdzuna } from "../lib/sources/adzuna.ts";
import { parseGreenhouse, parseLever, parseSmartRecruiters, parseWorkday, parseWorkdayUrl } from "../lib/sources/careers.ts";
import { extractJobPosting, isAllowed, parseRobots, parseSitemap, rankBySlug } from "../lib/sources/sitemap.ts";

const job = (o: Partial<RawJob>): RawJob => ({
  source: "t", externalId: "1", title: "", company: null, location: null, contract: null, url: "u", description: null, postedAt: null, ...o,
});

test("norm / containsWords : accents, casse, mots entiers", () => {
  assert.equal(norm("Contrôle Interne – Équipe"), "controle interne equipe");
  assert.ok(containsWords("Chargé de Contrôle interne H/F", "contrôle interne"));
  assert.ok(!containsWords("International Risk Analyst", "intern"));
  assert.ok(containsWords("Risk Analyst Intern", "intern"));
});

test("guessContract", () => {
  assert.equal(guessContract("Permanent contract"), "CDI");
  assert.equal(guessContract("Stage 6 mois"), "STAGE");
  assert.equal(guessContract("Alternance - Analyste"), "ALTERNANCE");
  assert.equal(guessContract("VIE Risk Analyst – Singapour"), "VIE");
  assert.equal(guessContract("Risk Analyst"), null);
});

test("htmlToText gère le HTML échappé (Greenhouse)", () => {
  assert.equal(htmlToText("&lt;p&gt;Hello &amp;amp; bye&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;"), "Hello & bye\n• Python");
});

test("prefilter : garde, exclut, contrat, lieu", () => {
  const f = DEFAULT_FILTERS;
  assert.deepEqual(prefilter(job({ title: "Operational Risk Analyst", location: "Paris 8e" }), f), { keep: true });
  assert.equal(prefilter(job({ title: "Stage - Analyste risques" }), f).keep, false);
  assert.equal(prefilter(job({ title: "Senior Risk Analyst" }), f).keep, false);
  assert.equal(prefilter(job({ title: "Développeur React" }), f).keep, false);
  assert.equal(prefilter(job({ title: "Risk Analyst", contract: "CDD" }), f).keep, false);
  assert.equal(prefilter(job({ title: "Risk Analyst", location: "Lyon" }), f).keep, false);
  assert.equal(prefilter(job({ title: "Analyste risque", location: "92 - COURBEVOIE" }), f).keep, true, "département");
  assert.equal(prefilter(job({ title: "Risk Analyst", location: null }), f).keep, true, "lieu inconnu = gardé");
});

test("parseList", () => {
  assert.deepEqual(parseList("a, b\nc;; a"), ["a", "b", "c"]);
});

test("France Travail", () => {
  const r = parseFranceTravail({ resultats: [{ id: "123ABC", intitule: "Analyste risques H/F", typeContrat: "CDI", entreprise: { nom: "BPCE" }, lieuTravail: { libelle: "75 - PARIS 13" } }] });
  assert.equal(r[0].contract, "CDI");
  assert.equal(r[0].url, "https://candidat.francetravail.fr/offres/recherche/detail/123ABC");
  assert.deepEqual(parseFranceTravail(null), []);
});

test("Adzuna", () => {
  const r = parseAdzuna({ results: [{ id: "9", title: "<strong>Risk</strong> Analyst", redirect_url: "https://x", contract_type: "permanent", description: "Great &amp; nice" }] });
  assert.equal(r[0].title, "Risk Analyst");
  assert.equal(r[0].contract, "CDI");
  assert.equal(r[0].description, "Great & nice");
});

test("Greenhouse / Lever / SmartRecruiters", () => {
  const gh = parseGreenhouse({ jobs: [{ id: 1, title: "Risk Analyst", absolute_url: "https://g/1", location: { name: "Paris" }, content: "&lt;p&gt;x&lt;/p&gt;" }] }, { type: "greenhouse", id: "acme", label: "Acme" });
  assert.equal(gh[0].description, "x");
  const lv = parseLever([{ id: "a", text: "Analyst", hostedUrl: "https://l/a", categories: { commitment: "Permanent", location: "Paris" }, descriptionPlain: "Desc" }], { type: "lever", id: "acme", label: "Acme" });
  assert.equal(lv[0].contract, "CDI");
  const sr = parseSmartRecruiters({ content: [{ id: "77", name: "Risk Analyst", location: { city: "Paris", country: "fr" }, typeOfEmployment: { label: "Permanent" } }] }, { type: "smartrecruiters", id: "Acme1", label: "Acme" });
  assert.equal(sr[0].url, "https://jobs.smartrecruiters.com/Acme1/77");
  assert.equal(sr[0].location, "Paris, FR");
  assert.ok(sr[0].detailRef?.endsWith("/companies/Acme1/postings/77"));
});

test("Workday : URL et parsing", () => {
  assert.deepEqual(parseWorkdayUrl("https://acme.wd3.myworkdayjobs.com/fr-FR/AcmeCareers"), { origin: "https://acme.wd3.myworkdayjobs.com", tenant: "acme", site: "AcmeCareers" });
  assert.throws(() => parseWorkdayUrl("https://example.com/jobs"));
  const src = { type: "workday" as const, id: "https://acme.wd3.myworkdayjobs.com/AcmeCareers", label: "Acme" };
  const r = parseWorkday({ jobPostings: [{ title: "Risk Analyst", externalPath: "/job/Paris/Risk-Analyst_R1", locationsText: "Paris" }] }, src);
  assert.equal(r[0].url, "https://acme.wd3.myworkdayjobs.com/AcmeCareers/job/Paris/Risk-Analyst_R1");
  assert.equal(r[0].detailRef, "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/AcmeCareers/job/Paris/Risk-Analyst_R1");
});

test("robots.txt", () => {
  const rules = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /search\nAllow: /search/jobs\nDisallow: /*?page=\n");
  assert.ok(isAllowed(rules, "/jobs/123"));
  assert.ok(!isAllowed(rules, "/search?q=x"));
  assert.ok(isAllowed(rules, "/search/jobs/1"));
  assert.ok(!isAllowed(rules, "/jobs?page=2"));
  assert.ok(isAllowed(parseRobots(null), "/anything"));
});

test("sitemap + classement par slug", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://j.com/job/risk-analyst-1</loc><lastmod>2026-11-06</lastmod></url><url><loc>https://j.com/job/chef-cuisine-2</loc></url></urlset>`;
  const p = parseSitemap(xml);
  assert.equal(p.urls.length, 2);
  assert.equal(p.urls[0].lastmod, "2026-11-06");
  const idx = parseSitemap(`<sitemapindex><sitemap><loc><![CDATA[https://j.com/jobs.xml]]></loc></sitemap></sitemapindex>`);
  assert.deepEqual(idx.sitemaps, ["https://j.com/jobs.xml"]);
  assert.equal(rankBySlug(p.urls.map((u) => u.loc).reverse(), ["risk"])[0], "https://j.com/job/risk-analyst-1");
});

test("JSON-LD JobPosting (avec @graph)", () => {
  const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"JobPosting","title":"Analyste Risque Opérationnel","description":"<p>Missions &amp; profil</p>","datePosted":"2026-11-02","employmentType":"FULL_TIME","hiringOrganization":{"name":"Banque X"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Paris","postalCode":"75009","addressCountry":"FR"}},"jobStartDate":"2027-09-01"}]}</script></html>`;
  const j = extractJobPosting(html, "https://j.com/job/1", { type: "sitemap", id: "https://j.com/sitemap.xml", label: "X" })!;
  assert.equal(j.title, "Analyste Risque Opérationnel");
  assert.equal(j.company, "Banque X");
  assert.equal(j.location, "Paris, 75009, FR");
  assert.match(j.description!, /Missions & profil/);
  assert.match(j.description!, /2027-09-01/);
  assert.equal(extractJobPosting("<html></html>", "https://j.com/x", { type: "sitemap", id: "https://j.com/s.xml", label: "X" }), null);
});
