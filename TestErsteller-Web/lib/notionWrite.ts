import type { ImportDraft } from "./adminTypes";
import { LEGACY_WPF_DATABASE_MAP } from "./wpfDatabaseMap";

const NOTION_VERSION = "2026-03-11";

function headers(json = true) {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) throw new Error("NOTION_TOKEN ist nicht gesetzt.");
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function normalize(id: string) { return id.replace(/-/g, ""); }

async function resolveDataSourceId(databaseId: string) {
  const id = normalize(databaseId);
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${id}`, { headers: headers(), cache: "no-store" });
  if (dbRes.ok) {
    const db = await dbRes.json();
    const dataSourceId = db?.data_sources?.[0]?.id;
    if (dataSourceId) return dataSourceId as string;
  }
  const dsRes = await fetch(`https://api.notion.com/v1/data_sources/${id}`, { headers: headers(), cache: "no-store" });
  if (dsRes.ok) return id;
  throw new Error(`Ziel-Datenbank konnte nicht geöffnet werden (${await dbRes.text().catch(() => "") || await dsRes.text().catch(() => "")}).`);
}

function chunks(text: string) {
  const value = text || "";
  const result: any[] = [];
  for (let i = 0; i < value.length; i += 1900) result.push({ type: "text", text: { content: value.slice(i, i + 1900) } });
  return result;
}

function findSchemaProperty(properties: Record<string, any>, aliases: string[]) {
  for (const alias of aliases) if (properties[alias]) return [alias, properties[alias]] as const;
  const lower = new Map(Object.entries(properties).map(([name, schema]) => [name.toLowerCase(), [name, schema] as const]));
  for (const alias of aliases) {
    const hit = lower.get(alias.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

function textPropertyValue(type: string, value: string, numeric?: number) {
  if (type === "title") return { title: chunks(value) };
  if (type === "rich_text") return { rich_text: chunks(value) };
  if (type === "number") return { number: Number.isFinite(numeric) ? numeric : (Number(String(value).replace(",", ".")) || null) };
  if (type === "select") return value ? { select: { name: value } } : { select: null };
  if (type === "multi_select") return { multi_select: value ? value.split(",").map((name) => ({ name: name.trim() })).filter((x) => x.name) : [] };
  if (type === "status") return value ? { status: { name: value } } : { status: null };
  if (type === "url") return { url: value || null };
  return undefined;
}

function dataUrlParts(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error("Das Aufgabenbild hat kein gültiges Data-URL-Format.");
  return { contentType: match[1], bytes: Buffer.from(match[2], "base64") };
}

async function uploadImage(dataUrl: string, filename: string) {
  const { contentType, bytes } = dataUrlParts(dataUrl);
  if (bytes.length > 20 * 1024 * 1024) throw new Error("Das Aufgabenbild ist größer als 20 MB.");
  const create = await fetch("https://api.notion.com/v1/file_uploads", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ mode: "single_part", filename, content_type: contentType }),
  });
  if (!create.ok) throw new Error(`Notion-Dateiupload konnte nicht gestartet werden: ${await create.text()}`);
  const upload = await create.json();
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes).buffer], { type: contentType }), filename);
  const send = await fetch(`https://api.notion.com/v1/file_uploads/${upload.id}/send`, {
    method: "POST",
    headers: headers(false),
    body: form,
  });
  if (!send.ok) throw new Error(`Aufgabenbild konnte nicht zu Notion hochgeladen werden: ${await send.text()}`);
  return upload.id as string;
}

export async function createTaskInNotion(draft: ImportDraft) {
  const databaseId = LEGACY_WPF_DATABASE_MAP?.[draft.classLevel]?.[draft.topic]?.[draft.competence];
  if (!databaseId) throw new Error(`Keine Ziel-Datenbank für Klasse ${draft.classLevel}, ${draft.topic}, ${draft.competence}.`);
  const dataSourceId = await resolveDataSourceId(databaseId);
  const schemaRes = await fetch(`https://api.notion.com/v1/data_sources/${normalize(dataSourceId)}`, { headers: headers(), cache: "no-store" });
  if (!schemaRes.ok) throw new Error(`Notion-Schema konnte nicht geladen werden: ${await schemaRes.text()}`);
  const schema = await schemaRes.json();
  const props: Record<string, any> = {};

  const set = (aliases: string[], value: string, numeric?: number) => {
    const hit = findSchemaProperty(schema.properties || {}, aliases);
    if (!hit) return;
    const [name, config] = hit;
    const v = textPropertyValue(config.type, value, numeric);
    if (v) props[name] = v;
  };

  set(["Titel", "Name", "Title"], draft.title);
  set(["Aufgabe", "Aufgabentext", "Question"], draft.questionText);
  set(["Aufgabenbereich", "AFB", "Anforderungsbereich"], draft.afbRaw);
  set(["Punkte", "MaxPoints", "Punktzahl"], draft.pointsRaw || String(draft.maxPoints), draft.maxPoints);
  set(["Zeit", "Bearbeitungszeit", "Bearbeitungsdauer", "Zeitaufwand", "Dauer", "EstimatedTime", "Minuten"], String(draft.estimatedTime), draft.estimatedTime);
  set(["Erwartungshorizont", "Erwartung", "Expectation"], draft.expectation);
  set(["Klasse", "Jahrgang", "Jahrgangsstufe"], draft.classLevel, Number(draft.classLevel));
  set(["Thema", "Topic"], draft.topic);
  set(["Kompetenz", "Prozessbezogene Kompetenz", "Competence"], draft.competence);

  if (draft.imageDataUrl) {
    const hit = findSchemaProperty(schema.properties || {}, ["Bild", "Image", "Grafik"]);
    if (hit && hit[1].type === "files") {
      const name = draft.imageName || `${draft.title.replace(/[^a-z0-9äöüß_-]+/gi, "-") || "aufgabe"}.png`;
      const fileUploadId = await uploadImage(draft.imageDataUrl, name);
      props[hit[0]] = { files: [{ type: "file_upload", file_upload: { id: fileUploadId }, name }] };
    }
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: dataSourceId }, properties: props }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403) throw new Error(`Notion verweigert das Schreiben. Aktiviere für die Integration „Insert content“. Details: ${text}`);
    throw new Error(`Notion-Import fehlgeschlagen (${res.status}): ${text}`);
  }
  const page = await res.json();
  return { id: page.id as string, url: page.url as string, title: draft.title };
}
