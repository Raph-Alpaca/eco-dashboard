/**
 * data.js — 코드북·큐브 로더. config.js 의 dataSource 에 따라 정적 파일 또는 API 에서 읽는다.
 * 화면 코드는 이 모듈만 통해 데이터를 얻으므로, 실데이터·서버 연계 시 여기만 바꾸면 된다.
 */
import { CubeIndex } from "./aggregate.js";

const CFG = window.ECO_CONFIG || { dataSource: "static", dataBase: "data/", buildId: "dev" };
const SCHEMA_VERSION = 1;
const cache = new Map();

function url(path) {
  const base = CFG.dataSource === "api" ? (CFG.apiBase || "") : (CFG.dataBase || "data/");
  const sep = path.includes("?") ? "&" : "?";
  return `${base}${path}${sep}v=${encodeURIComponent(CFG.buildId || "dev")}`;
}

async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch(url(path)).then(async r => {
    if (!r.ok) throw new Error(`${path} 을(를) 불러오지 못했습니다 (${r.status})`);
    return r.json();
  });
  cache.set(path, p);
  try { return await p; } catch (e) { cache.delete(path); throw e; }
}

export const SURVEYS = {
  school_survey: { id: "school_survey", file: "codebook/school_survey.json" },
  status_survey: { id: "status_survey", file: "codebook/status_survey.json" },
};

export async function loadCodebook(surveyId) {
  const cb = await getJSON(SURVEYS[surveyId].file);
  if (cb.schemaVersion !== SCHEMA_VERSION) throw new Error(`코드북 schemaVersion ${cb.schemaVersion} ≠ ${SCHEMA_VERSION}`);
  return cb;
}

export async function loadCube(surveyId, pop) {
  const key = `cube:${pop}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const [cb, cube] = await Promise.all([loadCodebook(surveyId), getJSON(`cubes/${pop}.json`)]);
    if (cube.schemaVersion !== SCHEMA_VERSION) throw new Error(`큐브 schemaVersion 불일치: ${pop}`);
    return new CubeIndex(cube, cb);
  })();
  cache.set(key, p);
  try { return await p; } catch (e) { cache.delete(key); throw e; }
}

export async function loadManifest() {
  try { return await getJSON("cubes/manifest.json"); } catch { return null; }
}

/** 문항 목록(코드북) — 모집단별 */
export function questionsOf(cb, pop) {
  return cb.questions.filter(q => q.pop === pop);
}

/** 문항 → 큐브 키 선택지 (항목형은 항목별, 순위형은 r1/r12/r123) */
export function keyOptions(q) {
  if (q.type.startsWith("item_")) return (q.items || []).map(it => ({ key: `${q.qid}_${it.id}`, label: it.label }));
  if (q.type === "rank") return q.cubeKeys.map(k => ({ key: k, label: { r1: "1순위", r12: "1+2순위", r123: "1+2+3순위" }[k.split("_").pop()] || k }));
  return [{ key: q.qid, label: q.short }];
}

export const config = CFG;
