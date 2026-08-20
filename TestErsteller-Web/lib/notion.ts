import type { Competence, TaskItem } from "./types";
import { buildPointsByAfb, parsePointsSpec, parseSubTasks } from "./taskParsing";

const NOTION_VERSION = "2026-03-11";
const DEFAULT_DB_ID = "10233652f4bc801bab33d35a61a51f52";

const COMPETENCES: Competence[] = [
  "Argumentieren",
  "Problemlösen",
  "Modellieren",
  "Darstellungen",
  "Mathematik",
  "Kommunizieren",
];

function normalizeDbId(id?: string) {
  return (id || "").replace(/-/g, "").trim();
}

function titleText(property: any): string {
  if (!property) return "";
  const items = property.title || property.rich_text || [];
  return items.map((x: any) => x?.plain_text ?? x?.text?.content ?? "").join("");
}

function plainText(property: any): string {
  if (!property) return "";
  if (property.type === "title" || property.title) return titleText(property);
  if (property.type === "rich_text" || property.rich_text) {
    return (property.rich_text || []).map((x: any) => x?.plain_text ?? x?.text?.content ?? "").join("");
  }
  if (property.type === "select" || property.select) return property.select?.name ?? "";
  if (property.type === "multi_select" || property.multi_select) return (property.multi_select || []).map((x: any) => x.name).join(", ");
  if (property.type === "number" || Object.prototype.hasOwnProperty.call(property, "number")) return property.number == null ? "" : String(property.number);
  if (property.type === "formula" || property.formula) return String(property.formula?.string ?? property.formula?.number ?? property.formula?.boolean ?? "");
  return "";
}

function numberValue(property: any): number {
  if (!property) return 0;
  if (typeof property.number === "number") return property.number;
  const n = Number(plainText(property).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function filesUrl(property: any): string | undefined {
  const file = property?.files?.[0];
  return file?.file?.url || file?.external?.url || undefined;
}

function propertyByNames(props: Record<string, any>, names: string[]) {
  for (const name of names) {
    if (props[name] != null) return props[name];
  }
  const lower = Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of names) {
    if (lower[name.toLowerCase()] != null) return lower[name.toLowerCase()];
  }
  return undefined;
}

function parseCompetence(raw: string): Competence {
  const value = (raw || "").toLowerCase();
  if (value.includes("argument")) return "Argumentieren";
  if (value.includes("problem")) return "Problemlösen";
  if (value.includes("modell")) return "Modellieren";
  if (value.includes("darstell")) return "Darstellungen";
  if (value.includes("kommun")) return "Kommunizieren";
  return "Mathematik";
}

function parsePage(page: any, forcedCompetence?: Competence): TaskItem {
  const props = page.properties || {};
  const title = plainText(propertyByNames(props, ["Name", "Titel", "Title"])) || "Aufgabe";
  const questionText = plainText(propertyByNames(props, ["Aufgabe", "Aufgabentext", "Question"]));
  const afbRaw = plainText(propertyByNames(props, ["Aufgabenbereich", "AFB", "Anforderungsbereich"]));
  const pointsProperty = propertyByNames(props, ["Punkte", "MaxPoints", "Punktzahl"]);
  const pointsRaw = plainText(pointsProperty);
  const pointSpec = parsePointsSpec(pointsRaw);
  const maxPoints = pointSpec.maxPoints || numberValue(pointsProperty);
  const competenceRaw = plainText(propertyByNames(props, ["Kompetenz", "Prozessbezogene Kompetenz", "Competence"]));
  const topic = plainText(propertyByNames(props, ["Thema", "Topic"])) || "Allgemein";
  const classLevel = plainText(propertyByNames(props, ["Klasse", "Jahrgang", "Jahrgangsstufe"]));
  const expectation = plainText(propertyByNames(props, ["Erwartungshorizont", "Erwartung", "Expectation"]));
  const estimatedTime = numberValue(propertyByNames(props, ["Zeit", "Bearbeitungszeit", "EstimatedTime", "Minuten"]));
  const imageUrl = filesUrl(propertyByNames(props, ["Bild", "Image", "Grafik"]));

  const subTasks = parseSubTasks(questionText, afbRaw, pointsRaw);

  return {
    id: page.id,
    title,
    questionText,
    competence: forcedCompetence ?? parseCompetence(competenceRaw),
    topic,
    classLevel,
    maxPoints,
    pointsRaw,
    afbRaw,
    estimatedTime,
    expectation,
    imageUrl,
    pointsByAfb: buildPointsByAfb(subTasks, afbRaw, maxPoints),
    subTasks,
  };
}

function authHeaders() {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) throw new Error("NOTION_TOKEN ist nicht gesetzt.");
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function resolveDataSourceIds(databaseOrDataSourceId: string): Promise<string[]> {
  const id = normalizeDbId(databaseOrDataSourceId);
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${id}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (dbRes.ok) {
    const db = await dbRes.json();
    const ids = (db.data_sources || []).map((x: any) => x.id).filter(Boolean);
    if (ids.length) return ids;
  }

  // Allows NOTION_DATABASE_MAP_JSON to contain a data_source_id directly.
  const dsRes = await fetch(`https://api.notion.com/v1/data_sources/${id}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (dsRes.ok) return [id];

  const dbText = await dbRes.text().catch(() => "");
  const dsText = await dsRes.text().catch(() => "");
  throw new Error(`Notion-ID konnte weder als Database noch als Data Source aufgelöst werden. ${dbText || dsText}`);
}

async function queryDataSource(dataSourceId: string): Promise<any[]> {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${normalizeDbId(dataSourceId)}/query`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ page_size: 100, result_type: "page", ...(cursor ? { start_cursor: cursor } : {}) }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion ${res.status}: ${text}`);
    }
    const data = await res.json();
    pages.push(...(data.results || []).filter((x: any) => x.object === "page"));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function queryDatabase(databaseOrDataSourceId: string): Promise<any[]> {
  const dataSourceIds = await resolveDataSourceIds(databaseOrDataSourceId);
  const groups = await Promise.all(dataSourceIds.map(queryDataSource));
  return groups.flat();
}

function readMap(): Record<string, any> | null {
  const raw = process.env.NOTION_DATABASE_MAP_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("NOTION_DATABASE_MAP_JSON ist kein gültiges JSON.");
  }
}


function firstMappedDatabaseId(map: Record<string, any>): string | undefined {
  for (const classNode of Object.values(map)) {
    if (!classNode || typeof classNode !== "object") continue;
    for (const topicNode of Object.values(classNode as Record<string, any>)) {
      if (!topicNode || typeof topicNode !== "object") continue;
      for (const value of Object.values(topicNode as Record<string, any>)) {
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }
  return undefined;
}
function databaseIdsFor(classLevel?: string, topic?: string): Array<{ id: string; competence?: Competence }> {
  const map = readMap();
  const candidates: Array<{ id: string; competence?: Competence }> = [];
  if (map && classLevel && topic) {
    const topicNode = map?.[classLevel]?.[topic];
    if (topicNode && typeof topicNode === "object") {
      for (const competence of COMPETENCES) {
        const id = topicNode[competence];
        if (typeof id === "string" && id.trim()) candidates.push({ id, competence });
      }
    }
  }
  if (candidates.length) return candidates;
  return [{ id: process.env.NOTION_DATABASE_ID?.trim() || DEFAULT_DB_ID }];
}

export function notionConfigured() {
  return Boolean(process.env.NOTION_TOKEN?.trim());
}

export async function loadTasks(classLevel?: string, topic?: string): Promise<TaskItem[]> {
  const dbs = databaseIdsFor(classLevel, topic);
  const groups = await Promise.all(
    dbs.map(async ({ id, competence }) => (await queryDatabase(id)).map((page) => parsePage(page, competence)))
  );
  const all = groups.flat();
  return all.filter((task) => {
    const classOk = !classLevel || !task.classLevel || task.classLevel === classLevel;
    const topicOk = !topic || task.topic === "Allgemein" || task.topic === topic;
    return classOk && topicOk;
  });
}

export async function loadMeta() {
  const map = readMap();
  if (map && Object.keys(map).length) {
    const classes = Object.keys(map).sort();
    const topics = Array.from(new Set(classes.flatMap((c) => Object.keys(map[c] || {})))).sort();
    return { classes, topics };
  }
  const tasks = await loadTasks();
  const classes = Array.from(new Set(tasks.map((t) => t.classLevel).filter(Boolean) as string[])).sort();
  const topics = Array.from(new Set(tasks.map((t) => t.topic).filter(Boolean))).sort();
  return { classes, topics };
}

export async function testConnection() {
  const map = readMap();
  const db = (map && firstMappedDatabaseId(map)) || databaseIdsFor()[0]?.id;
  const dataSourceIds = await resolveDataSourceIds(db);
  const res = await fetch(`https://api.notion.com/v1/data_sources/${normalizeDbId(dataSourceIds[0])}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Notion-Verbindung fehlgeschlagen (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const title = titleText(data.title?.[0] ? { title: data.title } : undefined) || data.name || data.id;
  return { ok: true, title, dataSources: dataSourceIds.length };
}

