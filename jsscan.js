#!/usr/bin/env node

import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import { program } from "commander";
import chalk from "chalk";
import fs from "fs";
import https from "https";
import * as XLSX from "xlsx";

// =========================
// Configuration & Utilities
// =========================

// Regexes
const endpointRegex = /\/[a-zA-Z0-9_?&=\/\-#\.]+/g;
const jsFileRegex = /(?:\/|https?:\/\/)[a-zA-Z0-9_?&=\/\-#\.]+\.js(?:\?[^"'%60]*)?/g;

// Heuristic classification
const endpointCategories = [
  { label: "API", test: p => /^\/api\b|\/v\d+\/|\/graphql\b|\/rest\b/i.test(p) },
  { label: "Admin", test: p => /\/admin\b|\/dashboard\b|\/manage\b/i.test(p) },
  { label: "Auth", test: p => /\/login\b|\/logout\b|\/oauth\b|\/sso\b/i.test(p) },
  { label: "Static", test: p => /\.(css|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|map)(\?|$)/i.test(p) },
  { label: "API docs", test: p => /\/swagger\b|\/redoc\b|\/openapi\b/i.test(p) },
];

// Parameter risk heuristics
const riskyParams = [/id\b/i, /q(uery)?\b/i, /redirect\b/i, /next\b/i, /url\b/i, /token\b/i, /dest(ination)?\b/i];

// Basic technology signatures
const techSignatures = [
  { name: "Express", detector: ({ headers }) => /express/i.test(headers.get("x-powered-by") || "") },
  { name: "Next.js", detector: ({ html }) => /next\.js|__NEXT_DATA__/i.test(html) },
  { name: "React", detector: ({ html, assets }) => /react/i.test(html) || assets.some(a => /react(-dom)?/i.test(a)) },
  { name: "Angular", detector: ({ html, assets }) => /ng-version|angular/i.test(html) || assets.some(a => /angular/i.test(a)) },
  { name: "Vue.js", detector: ({ html, assets }) => /vue\.js|data-v-/i.test(html) || assets.some(a => /vue/i.test(a)) },
  { name: "Astro", detector: ({ html, assets }) => /astro/i.test(html) || assets.some(a => /_astro\//i.test(a)) },
  { name: "WordPress", detector: ({ html }) => /wp-content|wp-includes/i.test(html) },
  { name: "jQuery", detector: ({ assets }) => assets.some(a => /jquery.*\.js/i.test(a)) },
  { name: "Bootstrap", detector: ({ assets }) => assets.some(a => /bootstrap.*\.(css|js)/i.test(a)) },
  { name: "Netlify", detector: ({ html, assets }) => /netlify/i.test(html) || assets.some(a => /\/\.netlify\/scripts\//i.test(a)) },
  { name: "Vercel", detector: ({ headers }) => /vercel/i.test(headers.get("server") || "") },
];

// Resolve relative/protocol-relative URLs against a base
function resolveUrl(src, baseUrl) {
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return null;
  }
}

// Concurrency runner
async function runWithConcurrency(tasks, limit = 8) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = await tasks[idx]();
      } catch (e) {
        results[idx] = { error: e };
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, limit) }, worker);
  await Promise.all(workers);
  return results;
}

// Fetch with retry
async function fetchWithRetry(url, options, retries = 2, backoffMs = 400) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok && res.status >= 500 && attempt < retries) {
        await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, backoffMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

// =====================
// Data Stores per Scan
// =====================
function createStores() {
  return {
    endpoints: new Set(),
    parameters: new Map(),
    jsFiles: new Set(),
    technologies: new Set(),
    endpointTags: new Map(),
    riskyParameters: new Set(),
    findings: new Map(),
  };
}

function addFinding(stores, source, type, snippet, severity = "medium") {
  if (!stores.findings.has(source)) stores.findings.set(source, []);
  stores.findings.get(source).push({ type, snippet: snippet.slice(0, 500), severity });
}

function safeSnippet(text, matchIndex, context = 120) {
  if (!text) return "";
  if (typeof matchIndex === "number") {
    const start = Math.max(0, matchIndex - context);
    const end = Math.min(text.length, matchIndex + context);
    return text.slice(start, end).replace(/\s+/g, " ");
  }
  return String(text).replace(/\s+/g, " ");
}

// =====================
// XLSX Export
// =====================
function addSheetWithOptions(wb, data, sheetName) {
  const ws = XLSX.utils.json_to_sheet(data.length ? data : []);
  if (data.length) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: range.e }) };
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
  }
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
}

function exportResultsXLSX(outputFile, stores) {
  const wb = XLSX.utils.book_new();
  // Endpoints
  const endpointsData = Array.from(stores.endpoints).map(e => ({
    Endpoint: e,
    Tags: (stores.endpointTags.get(e) || []).join(", ")
  }));
  addSheetWithOptions(wb, endpointsData, "Endpoints");

  // Parameters
  const paramsData = Array.from(stores.parameters.entries()).map(([param, sources]) => {
    const counts = sources.reduce((acc, src) => {
      acc[src] = (acc[src] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([src, count]) => `${src} (${count})`)
      .join(", ");
    return {
      Parameter: param,
      Occurrences: sources.length,
      Sources: summary,
      Risky: stores.riskyParameters.has(param) ? "Yes" : "No"
    };
  });
  addSheetWithOptions(wb, paramsData, "Parameters");

  // JS Files
  const jsData = Array.from(stores.jsFiles).map(f => ({ JSFile: f }));
  addSheetWithOptions(wb, jsData, "JS Files");

  // Technologies
  const techData = Array.from(stores.technologies).map(t => ({ Technology: t }));
  addSheetWithOptions(wb, techData, "Technologies");

  // Findings
  const findingsRows = [];
  for (const [src, items] of stores.findings.entries()) {
    for (const it of items) {
      findingsRows.push({
        Source: src,
        Type: it.type,
        Severity: it.severity,
        Snippet: it.snippet
      });
    }
  }
  addSheetWithOptions(wb, findingsRows, "Findings");

  // Summary
  const summaryData = [
    { Metric: "Endpoints", Count: stores.endpoints.size },
    { Metric: "Parameters", Count: stores.parameters.size },
    { Metric: "Risky Parameters", Count: stores.riskyParameters.size },
    { Metric: "JS Files", Count: stores.jsFiles.size },
    { Metric: "Technologies", Count: stores.technologies.size },
    { Metric: "Findings", Count: findingsRows.length }
  ];
  addSheetWithOptions(wb, summaryData, "Summary");

  XLSX.writeFile(wb, outputFile);
  console.log(chalk.green(`Results exported to ${outputFile} (XLSX)`));
}

function exportResults(format, outputFile, stores) {
  if (format === "json") {
    const data = {
      endpoints: Array.from(stores.endpoints),
      endpointTags: Object.fromEntries(stores.endpointTags),
      parameters: Object.fromEntries(stores.parameters),
      riskyParameters: Array.from(stores.riskyParameters),
      jsFiles: Array.from(stores.jsFiles),
      technologies: Array.from(stores.technologies),
      findings: Object.fromEntries([...stores.findings.entries()].map(([k, v]) => [k, v]))
    };
    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
    console.log(chalk.green(`Results exported to ${outputFile} (JSON)`));
    return;
  }
  if (format === "xlsx") {
    exportResultsXLSX(outputFile, stores);
    return;
  }
  console.error(chalk.red("❌ Unsupported format. Use: json or xlsx only."));
}

// =====================
// Content Processing
// =====================
function processContent(content, source, stores) {
  if (!content) return;
  for (const match of content.matchAll(endpointRegex)) {
    const endpoint = match[0];
    stores.endpoints.add(endpoint);
    const cats = endpointCategories.filter(c => c.test(endpoint)).map(c => c.label);
    if (cats.length) stores.endpointTags.set(endpoint, cats);

    const query = endpoint.split("?")[1];
    if (query) {
      query.split("&").forEach(param => {
        const [key] = param.split("=");
        if (key) {
          if (!stores.parameters.has(key)) stores.parameters.set(key, []);
          stores.parameters.get(key).push(source);
          if (riskyParams.some(rx => rx.test(key))) stores.riskyParameters.add(key);
        }
      });
    }
  }
  for (const match of content.matchAll(jsFileRegex)) {
    stores.jsFiles.add(match[0]);
  }
}

// =====================
// Security Patterns
// =====================
const securityPatterns = {
  domXss: { re: /(innerHTML|outerHTML|document\.write|insertAdjacentHTML|insertBefore|replaceChild)\s*\(/g, severity: "critical" },
  dynamicEval: { re: /(eval|new Function|Function\()/g, severity: "critical" },
  execDanger: { re: /(execScript|document\.write\(|setTimeout\(\s*['"`])/g, severity: "critical" },
  hardcodedSecrets: { re: /(api[_-]?key|secret|token|auth|bearer)[^"'`]{0,60}['"`][A-Za-z0-9_\-]{6,}/gi, severity: "critical" },
  jwtLiteral: { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g, severity: "high" },
  openRedirect: { re: /(location\.href|window\.location|document\.location)\s*=\s*[A-Za-z0-9_'"`$.(){}\s-]*[+?&]?[A-Za-z0-9_'"`$.(){}\s-]*/g, severity: "high" },
  weakCrypto: { re: /(MD5|md5|SHA1|sha1|crypto\.createHash\(\s*['"`](?:md5|sha1)['"`]\s*\))/gi, severity: "high" },
  protoPollution: { re: /(__proto__|constructor\.prototype|Object\.prototype\[\s*'__proto__'\s*\])/g, severity: "high" },
  websocket: { re: /(wss?:\/\/[a-zA-Z0-9_.\-:\/]+)/g, severity: "medium" },
  urlParsing: { re: /(new URL\(|URLSearchParams|location\.search|location\.hash)/g, severity: "medium" },
  corsHints: { re: /(Access-Control-Allow-Origin|mode:\s*['"`]no-cors['"`]|allow-origin:\s*\*|cors)/gi, severity: "high" },
  fileUpload: { re: /(input\[type=['"`]file['"`]\]|FormData|file\.name|file\.size|accept=.*file)/gi, severity: "medium" },
  postMessage: { re: /postMessage\(/g, severity: "medium" },
  cryptoSubtle: { re: /crypto\.subtle\./g, severity: "medium" },
  base64Use: { re: /(atob|btoa)\(/g, severity: "medium" },
  debugLogs: { re: /console\.(log|error|warn|debug)\(/g, severity: "low" },
  todoFixme: { re: /(TODO|FIXME)/g, severity: "low" },
  deprecated: { re: /(escape\(|unescape\()/g, severity: "low" },
  weakRandom: { re: /Math\.random\(/g, severity: "low" },
  obfuscationPatterns: { re: /(eval\(function\(p,a,c,k,e,d\)|\\x[0-9A-Fa-f]{2,}|\\u[0-9A-Fa-f]{4,})/g, severity: "high" },
  antiDebug: { re: /(debugger;|toString\(\)\s*===\s*function\(\)|detectDevTools|devtools)/gi, severity: "medium" },
  dynamicURLFetch: { re: /(fetch|axios|XMLHttpRequest)\s*\(\s*[^'"]*\+/g, severity: "medium" },
    graphql: { re: /\/graphql\b/gi, severity: "high" },
  internalAPI: { re: /\/(admin|private|internal|config|setup)\b/gi, severity: "high" },
  awsKey: { re: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
  gcpKey: { re: /AIza[0-9A-Za-z-_]{35}/g, severity: "critical" },
  firebaseKey: { re: /[A-Za-z0-9_\-]{36}:[A-Za-z0-9_\-]{16}/g, severity: "critical" },
  stripeKey: { re: /sk_live_[0-9a-zA-Z]{24}/g, severity: "critical" },

};

// Analyze JS content
function analyzeJSContent(content, source, stores) {
  processContent(content, source, stores);
  for (const [label, { re, severity }] of Object.entries(securityPatterns)) {
    const flags = re.flags && re.flags.includes("g") ? re.flags : (re.flags || "") + "g";
    const gRe = new RegExp(re.source, flags);
    let match;
    while ((match = gRe.exec(content)) !== null) {
      const snippet = safeSnippet(content, match.index, 200);
      addFinding(stores, source, label, snippet, severity);
      if (gRe.lastIndex === match.index) gRe.lastIndex++;
    }
  }
}

// Detect technologies
function detectTechnologies({ headers, html, assets }, stores) {
  for (const sig of techSignatures) {
    try { if (sig.detector({ headers, html, assets })) stores.technologies.add(sig.name); } catch {}
  }
  const powered = headers.get("x-powered-by"), server = headers.get("server");
  if (powered) stores.technologies.add(`x-powered-by: ${powered}`);
  if (server) stores.technologies.add(`server: ${server}`);
}

// TLS agent
function buildAgent({ insecure, caPath }) {
  if (insecure) return new https.Agent({ rejectUnauthorized: false });
  if (caPath) return new https.Agent({ ca: fs.readFileSync(caPath) });
  return undefined;
}

// =====================
// Target Analysis
// =====================
async function analyzeTarget(url, options) {
  const { silent, verbose, concurrency, format, output, insecure, ca } = options;
  const stores = createStores();
  const agent = buildAgent({ insecure, caPath: ca });
  const fetchOpts = agent ? { agent } : {};

  try {
    const res = await fetchWithRetry(url, fetchOpts);
    const html = await res.text();
    const dom = new JSDOM(html);

    processContent(html, "Page content", stores);

    const inlineScripts = dom.window.document.querySelectorAll("script:not([src])");
    inlineScripts.forEach((s, idx) => {
      analyzeJSContent(s.textContent || "", `Inline script ${idx + 1}`, stores);
    });

    const assetsFromHTML = Array.from(html.matchAll(jsFileRegex)).map(m => resolveUrl(m[0], url)).filter(Boolean);
    detectTechnologies({ headers: res.headers, html, assets: assetsFromHTML }, stores);

    // Filter JS: target domain + subdomains only
    const scripts = dom.window.document.getElementsByTagName("script");
    const scriptUrls = [];
    const targetHost = new URL(url).hostname;
    function isSameDomainOrSubdomain(host) { return host === targetHost || host.endsWith("." + targetHost); }

    for (const script of scripts) {
      if (script.src) {
        const full = resolveUrl(script.src, url);
        if (full) {
          try {
            const u = new URL(full);
            if (isSameDomainOrSubdomain(u.hostname)) {
              scriptUrls.push(full);
              stores.jsFiles.add(full);
            } else if (verbose) {
              console.log(chalk.gray(`Skipping external JS: ${full}`));
            }
          } catch {}
        }
      }
    }

    const tasks = scriptUrls.map(src => async () => {
      try {
        const jsRes = await fetchWithRetry(src, fetchOpts);
        const jsText = await jsRes.text();
        analyzeJSContent(jsText, src, stores);
      } catch (err) {
        if (!silent) console.error(chalk.red(`Error fetching ${src}: ${err.message}`));
      }
    });

    if (verbose) console.log(chalk.gray(`Fetching ${scriptUrls.length} target JS assets with concurrency=${concurrency}...`));
    await runWithConcurrency(tasks, concurrency);

    if (!silent) {
      console.log(chalk.blue.bold(`\nEndpoints (${stores.endpoints.size}):`));
      stores.endpoints.forEach(e => console.log(`  ${e} ${chalk.gray(`[${(stores.endpointTags.get(e)||[]).join(", ")}]`)}`));
      console.log(chalk.green.bold(`\nParameters (${stores.parameters.size}):`));
      stores.parameters.forEach((sources, param) => {
        const summary = sources.reduce((acc, src) => { acc[src]=(acc[src]||0)+1; return acc; }, {});
        const summText = Object.entries(summary).map(([s,c])=>`${s} (${c})`).join(", ");
        console.log(`  ${param}${stores.riskyParameters.has(param)?chalk.red(" [risky]"):""} → ${summText}`);
      });
      console.log(chalk.yellow.bold(`\nJS Files (${stores.jsFiles.size}):`));
      stores.jsFiles.forEach(f => console.log(`  ${f}`));
      console.log(chalk.magenta.bold(`\nTechnologies (${stores.technologies.size}):`));
      stores.technologies.forEach(t => console.log(`  ${t}`));

      let totalFindings = 0;
      for (const items of stores.findings.values()) totalFindings += items.length;
      console.log(chalk.red.bold(`\nSecurity Findings (${totalFindings}):`));
      for (const [src, items] of stores.findings.entries()) {
        console.log(chalk.gray(`\n  Source: ${src} (${items.length})`));
        for (const it of items) {
          const sev = it.severity==="critical"?chalk.bgRed.white(" CRITICAL "):
                      it.severity==="high"?chalk.red(" HIGH "):
                      it.severity==="medium"?chalk.yellow(" MED "):chalk.blue(" LOW ");
          console.log(`    ${sev} ${it.type} → ${it.snippet}`);
        }
      }
    }

    if (output) exportResults(format, output, stores);

  } catch (err) { console.error(chalk.red(`Failed to fetch ${url}: ${err.message}`)); }
}

// Load targets
async function loadTargets({ urlArg, listFile, stdin }) {
  const targets = [];
  if (urlArg) targets.push(urlArg);
  if (listFile) {
    const lines = fs.readFileSync(listFile, "utf-8").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    targets.push(...lines);
  }
  if (stdin) {
    const input = await new Promise(resolve => {
      let data = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", chunk => data += chunk);
      process.stdin.on("end", () => resolve(data));
    });
    const lines = input.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    targets.push(...lines);
  }
  return Array.from(new Set(targets));
}

// =================
// CLI Definition
// =================
program
  .name("web-recon")
  .description("Extract endpoints, parameters, target-origin JS files, technologies and perform JS security analysis")
  .argument("[url]", "Target URL")
  .option("-l, --list <file>", "File containing list of URLs")
  .option("--stdin", "Read URLs from stdin")
  .option("-o, --output <file>", "Export results to file")
  .option("-f, --format <type>", "Export format: json or xlsx", v => { v=v.toLowerCase(); if(!["json","xlsx"].includes(v)){console.error(chalk.red("Invalid format"));process.exit(1);} return v; }, "json")
  .option("-c, --concurrency <n>", "Concurrent JS fetches per target", v=>parseInt(v,10), 8)
  .option("--insecure", "Disable TLS verification")
  .option("--ca <file>", "Custom Root CA bundle")
  .option("--silent", "Suppress console output")
  .option("--verbose", "Verbose logging")
  .action(async (urlArg, options) => {
    const targets = await loadTargets({ urlArg, listFile: options.list, stdin: options.stdin });
    if (!targets.length) { console.error(chalk.red("No targets provided")); process.exit(1); }
    for (const url of targets) {
      if (!options.silent) console.log(chalk.white.bold(`\n=== Scanning: ${url} ===`));
      await analyzeTarget(url, options);
    }
  });

program.parse(process.argv);
