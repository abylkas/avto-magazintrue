// report.js — Ежедневный отчёт в Telegram
// Запускается каждый день в 06:00 по Бишкеку через GitHub Actions

const TELEGRAM_TOKEN  = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FIREBASE_URL    = process.env.FIREBASE_URL;

// Вчерашняя дата
function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10); // "2026-05-20"
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' сом';
}

async function fetchFirebase(path) {
  const url = `${FIREBASE_URL}/${path}.json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Firebase error: ${resp.status}`);
  return resp.json();
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    })
  });
  const data = await resp.json();
  if (!data.ok) throw new Error('Telegram error: ' + JSON.stringify(data));
  return data;
}

async function main() {
  const yesterday = getYesterday();
  console.log('Generating report for:', yesterday);

  // Получаем все продажи из Firebase
  const salesData = await fetchFirebase('sales');

  if (!salesData) {
    await sendTelegram(`📊 <b>Отчёт за ${formatDate(yesterday)}</b>\n\nПродаж не было.`);
    return;
  }

  // Фильтруем по вчерашней дате
  const allSales = Object.values(salesData);
  const daySales = allSales.filter(s => {
    return new Date(s.ts).toISOString().slice(0, 10) === yesterday;
  });

  if (daySales.length === 0) {
    await sendTelegram(
      `📊 <b>Отчёт за ${formatDate(yesterday)}</b>\n\n` +
      `😔 Продаж в этот день не было.`
    );
    return;
  }

  // Считаем итоги
  const totalRev  = daySales.reduce((a, s) => a + s.qty * s.salePrice, 0);
  const totalProf = daySales.reduce((a, s) => a + s.profit, 0);
  const totalCost = daySales.reduce((a, s) => a + s.qty * s.cost, 0);
  const margin    = Math.round(totalProf / totalRev * 100);

  // По продавцам
  const byUser = {};
  daySales.forEach(s => {
    if (!byUser[s.user]) byUser[s.user] = { rev: 0, prof: 0, cnt: 0 };
    byUser[s.user].rev  += s.qty * s.salePrice;
    byUser[s.user].prof += s.profit;
    byUser[s.user].cnt++;
  });

  // По категориям
  const byCat = {};
  daySales.forEach(s => {
    if (!byCat[s.cat]) byCat[s.cat] = { rev: 0, prof: 0 };
    byCat[s.cat].rev  += s.qty * s.salePrice;
    byCat[s.cat].prof += s.profit;
  });

  // Сортируем продажи по времени
  const sorted = [...daySales].sort((a, b) => a.ts - b.ts);

  // Строим сообщение
  let msg = '';

  // Заголовок
  msg += `🚗 <b>ОТЧЁТ ЗА ${formatDate(yesterday).toUpperCase()}</b>\n`;
  msg += `${'─'.repeat(30)}\n\n`;

  // Итоги
  msg += `📈 <b>ИТОГИ ДНЯ</b>\n`;
  msg += `💰 Выручка:       <b>${fmt(totalRev)}</b>\n`;
  msg += `📦 Себестоимость: <b>${fmt(totalCost)}</b>\n`;
  msg += `✅ Прибыль:       <b>${fmt(totalProf)}</b>\n`;
  msg += `📊 Маржа:         <b>${margin}%</b>\n`;
  msg += `🛍 Продаж:        <b>${daySales.length} шт</b>\n\n`;

  // По продавцам
  msg += `👤 <b>ПО ПРОДАВЦАМ</b>\n`;
  Object.entries(byUser)
    .sort((a, b) => b[1].prof - a[1].prof)
    .forEach(([user, v]) => {
      msg += `  • ${user}: ${fmt(v.rev)} / прибыль ${fmt(v.prof)} (${v.cnt} прод.)\n`;
    });
  msg += '\n';

  // По категориям
  msg += `🏷 <b>ПО КАТЕГОРИЯМ</b>\n`;
  Object.entries(byCat)
    .sort((a, b) => b[1].rev - a[1].rev)
    .forEach(([cat, v]) => {
      msg += `  • ${cat}: ${fmt(v.rev)}\n`;
    });
  msg += '\n';

  // Список продаж
  msg += `🧾 <b>ВСЕ ПРОДАЖИ</b>\n`;
  sorted.forEach((s, i) => {
    const time = new Date(s.ts).toLocaleTimeString('ru-RU', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek'
    });
    const price = s.salePrice !== s.price
      ? `${fmt(s.salePrice)} (скидка)`
      : fmt(s.salePrice);
    msg += `${i + 1}. ${s.name}\n`;
    msg += `   ${s.user} · ${s.qty} шт · ${price} · ${time}\n`;
    msg += `   Прибыль: +${fmt(s.profit)}\n`;
  });

  // Telegram ограничение 4096 символов — режем если надо
  if (msg.length > 4000) {
    msg = msg.slice(0, 3900) + '\n\n... (список сокращён)';
  }

  await sendTelegram(msg);
  console.log('Report sent successfully!');
}

main().catch(async err => {
  console.error('Error:', err.message);
  try {
    await sendTelegram(`❌ Ошибка при формировании отчёта: ${err.message}`);
  } catch(e) {
    console.error('Failed to send error message:', e.message);
  }
  process.exit(1);
});
