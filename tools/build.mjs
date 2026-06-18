// Сборка самодостаточного юзерскрипта: встраивает deleted-ids.json прямо в код,
// чтобы скрипт не зависел от внешнего репозитория.
//
// Запуск:  node tools/build.mjs
// Результат: 404FIX.bundle.user.js — этот файл и нужно импортировать в Tampermonkey.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "404FIX.user.js");
const DATA = join(ROOT, "deleted-ids.json");
const OUT = join(ROOT, "404FIX.bundle.user.js");

const src = readFileSync(SRC, "utf8");
const data = JSON.parse(readFileSync(DATA, "utf8"));

// Компактный литерал (без пробелов) для минимального размера.
const embedded = JSON.stringify({ anime: data.anime, manga: data.manga });

const MARKER = /const EMBEDDED_DELETED_IDS = .*?\/\*__EMBEDDED_DELETED_IDS__\*\//;
if (!MARKER.test(src)) {
  console.error("❌ Маркер /*__EMBEDDED_DELETED_IDS__*/ не найден в 404FIX.user.js");
  process.exit(1);
}

const out = src.replace(
  MARKER,
  `const EMBEDDED_DELETED_IDS = ${embedded}; /*__EMBEDDED_DELETED_IDS__*/`,
);

writeFileSync(OUT, out);
console.log(`✅ Собрано: ${OUT}`);
console.log(`   встроено: anime=${data.anime.length}, manga=${data.manga.length} (источник ${data.generated_at})`);
console.log(`   размер бандла: ${(out.length / 1024).toFixed(0)} КБ`);
