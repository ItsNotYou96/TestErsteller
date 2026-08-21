import type { Competence, TaskItem } from "./types";
import { buildPointsByAfb, parsePointsSpec, parseSubTasks } from "./taskParsing";
import { LEGACY_CLASSES, LEGACY_WPF_DATABASE_MAP } from "./wpfDatabaseMap";

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

type DbMap = Record<string, Record<string, Partial<Record<Competence, string>>>>;

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
  if (!property) return undefined;

  // WPF used a Notion Files property named "Bild". Support both uploaded
  // Notion files and externally hosted files, plus URL/rich-text fallbacks so
  // older databases continue to work if the property type was changed later.
  const file = property?.files?.[0];
  const fileUrl = file?.file?.url || file?.external?.url;
  if (typeof fileUrl === "string" && fileUrl.trim()) return fileUrl.trim();

  if (typeof property?.url === "string" && property.url.trim()) return property.url.trim();

  const rich = property?.rich_text || property?.title || [];
  for (const item of rich) {
    const href = item?.href || item?.text?.link?.url;
    if (typeof href === "string" && href.trim()) return href.trim();
    const text = item?.plain_text ?? item?.text?.content;
    if (typeof text === "string" && /^https?:\/\//i.test(text.trim())) return text.trim();
  }

  const formulaString = property?.formula?.string;
  if (typeof formulaString === "string" && /^https?:\/\//i.test(formulaString.trim())) return formulaString.trim();

  return undefined;
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

function parsePage(
  page: any,
  forcedCompetence?: Competence,
  forcedTopic?: string,
  forcedClassLevel?: string,
): TaskItem {
  const props = page.properties || {};
  const title = plainText(propertyByNames(props, ["Titel", "Name", "Title"])) || "Aufgabe";
  const questionText = plainText(propertyByNames(props, ["Aufgabe", "Aufgabentext", "Question"]));
  const afbRaw = plainText(propertyByNames(props, ["Aufgabenbereich", "AFB", "Anforderungsbereich"]));
  const pointsProperty = propertyByNames(props, ["Punkte", "MaxPoints", "Punktzahl"]);
  const pointsRaw = plainText(pointsProperty);
  const pointSpec = parsePointsSpec(pointsRaw);
  const maxPoints = pointSpec.maxPoints || numberValue(pointsProperty);
  const competenceRaw = plainText(propertyByNames(props, ["Kompetenz", "Prozessbezogene Kompetenz", "Competence"]));
  const topicFromPage = plainText(propertyByNames(props, ["Thema", "Topic"]));
  const classFromPage = plainText(propertyByNames(props, ["Klasse", "Jahrgang", "Jahrgangsstufe"]));
  const expectation = plainText(propertyByNames(props, ["Erwartungshorizont", "Erwartung", "Expectation"]));
  const estimatedTime = numberValue(propertyByNames(props, ["Zeit", "Bearbeitungszeit", "EstimatedTime", "Minuten"]));
  const imageUrl = filesUrl(propertyByNames(props, ["Bild", "Image", "Grafik"]));

  const subTasks = parseSubTasks(questionText, afbRaw, pointsRaw);

  return {
    id: page.id,
    title,
    questionText,
    competence: forcedCompetence ?? parseCompetence(competenceRaw),
    topic: (forcedTopic ?? topicFromPage) || "Allgemein",
    classLevel: forcedClassLevel ?? classFromPage,
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

  // Die feste WPF-Zuordnung enthält Database-IDs. Direkte Data-Source-IDs
  // bleiben für benutzerdefinierte Overrides ebenfalls unterstützt.
  const dsRes = await fetch(`https://api.notion.com/v1/data_sources/${id}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (dsRes.ok) return [id];

  const dbText = await dbRes.text().catch(() => "");
  const dsText = await dsRes.text().catch(() => "");
  throw new Error(`Notion-ID ${id} konnte weder als Database noch als Data Source aufgelöst werden. ${dbText || dsText}`);
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

function readMap(): { map: DbMap; isOverride: boolean } {
  const raw = process.env.NOTION_DATABASE_MAP_JSON?.trim();
  if (!raw) return { map: LEGACY_WPF_DATABASE_MAP, isOverride: false };
  try {
    return { map: JSON.parse(raw) as DbMap, isOverride: true };
  } catch {
    throw new Error("NOTION_DATABASE_MAP_JSON ist kein gültiges JSON.");
  }
}

function firstMappedDatabaseId(map: DbMap): string | undefined {
  for (const classNode of Object.values(map)) {
    if (!classNode || typeof classNode !== "object") continue;
    for (const topicNode of Object.values(classNode)) {
      if (!topicNode || typeof topicNode !== "object") continue;
      for (const competence of COMPETENCES) {
        const value = topicNode[competence];
        if (typeof value === "string" && value.trim()) return value;
      }
    }
  }
  return undefined;
}

function databaseIdsFor(classLevel?: string, topic?: string): Array<{ id: string; competence?: Competence }> {
  const { map } = readMap();

  if (classLevel && topic) {
    const topicNode = map?.[classLevel]?.[topic];
    if (!topicNode) {
      throw new Error(`Für Klasse ${classLevel} und Thema „${topic}“ ist keine Datenbankzuordnung hinterlegt.`);
    }

    return COMPETENCES.map((competence) => {
      const id = topicNode[competence];
      if (!id) throw new Error(`Keine Datenbank für Kompetenz ${competence} in Thema „${topic}“ hinterlegt.`);
      return { id, competence };
    });
  }

  const first = firstMappedDatabaseId(map);
  return [{ id: first || process.env.NOTION_DATABASE_ID?.trim() || DEFAULT_DB_ID }];
}

export function notionConfigured() {
  return Boolean(process.env.NOTION_TOKEN?.trim());
}

export async function loadTasks(classLevel?: string, topic?: string): Promise<TaskItem[]> {
  if (!classLevel || !topic) {
    throw new Error("Klasse und Thema müssen ausgewählt sein.");
  }

  const dbs = databaseIdsFor(classLevel, topic);
  const groups = await Promise.all(
    dbs.map(async ({ id, competence }) => {
      try {
        const pages = await queryDatabase(id);
        return pages.map((page) => parsePage(page, competence, topic, classLevel));
      } catch (error) {
        const prefix = competence ? `${competence}: ` : "";
        throw new Error(`${prefix}${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  return groups.flat();
}

export async function loadMeta() {
  const { map, isOverride } = readMap();
  const classes = isOverride
    ? Object.keys(map).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    : [...LEGACY_CLASSES];

  const topicsByClass = Object.fromEntries(
    classes.map((classLevel) => [classLevel, Object.keys(map[classLevel] || {})]),
  ) as Record<string, string[]>;

  const topics = Array.from(new Set(Object.values(topicsByClass).flat()));
  return { classes, topics, topicsByClass };
}

export async function testConnection() {
  const { map } = readMap();
  const db = firstMappedDatabaseId(map) || databaseIdsFor()[0]?.id;
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
