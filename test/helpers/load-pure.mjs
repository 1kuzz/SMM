// Приём взят из Migrator (test/discovery-resilience.test.mjs): браузерный скрипт не
// подключить в node как модуль, поэтому проверяемый код вырезается из исходника и
// исполняется как есть. Отличие от Migrator — там вырезают по одной функции, а здесь
// целый блок между маркерами: функциям нужны общие константы (UNPARSED, списки имён
// заголовков), и держать их рядом честнее, чем дублировать в тесте.
//
// Побочный эффект, ради которого это и сделано так: если кто-нибудь добавит внутри блока
// обращение к config/document/networkLog, тест упадёт с ReferenceError — блок обязан
// оставаться чистым.
import { readFile } from 'node:fs/promises';

const BEGIN = '// --- PURE-HELPERS-BEGIN ---';
const END = '// --- PURE-HELPERS-END ---';

const EXPORTED = [
  'UNPARSED',
  'REDACTED_HEADER_NAMES',
  'truncateString',
  'parseRawHeaderString',
  'headerMapOf',
  'isSecretHeaderName',
  'redactHeaderMap',
  'redactTextBody',
  'parseJsonBody',
  'redactJson',
  'boundText',
  'jsonShape',
  'mergeShapes',
  'templatizeSegment',
  'endpointKeyOf',
  'foldRequests',
  'authCarriersOf',
  'buildEndpointInventory',
  'harHeaderList',
  'harQueryList',
  'harBodyText',
  'buildHarEntry',
  'buildHar',
  'looksLikeCredentialName',
  'tokenValueShape',
  'cookieNamesFrom',
  'summarizeAuthCarriers'
];

export async function loadPureHelpers() {
  const source = await readFile(new URL('../../action-logger-v7.js', import.meta.url), 'utf8');
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('маркеры PURE-HELPERS-BEGIN/END не найдены в action-logger-v7.js');
  }
  const block = source.slice(start + BEGIN.length, end);
  // 'use strict' — как в самом логгере: расхождение режимов скрыло бы ошибку,
  // которая в браузере есть, а в тесте нет.
  return Function(`'use strict';\n${block}\nreturn { ${EXPORTED.join(', ')} };`)();
}

export async function loggerSource() {
  return readFile(new URL('../../action-logger-v7.js', import.meta.url), 'utf8');
}

export { EXPORTED };
