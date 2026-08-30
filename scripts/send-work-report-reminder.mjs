// 月末稼働報告リマインダー
// 毎日 GitHub Actions から起動され、JSTで「月末最終日」または「その前日」の場合のみ、
// 承認済みスタッフ（当月未申請の人）へ稼働報告のお願いメールを送る。
//
// 環境変数:
//   FORCE=1   … 日付判定をスキップして必ず送る（手動テスト用）
//   TEST_TO   … 指定するとメールを全てこのアドレスに送る（本人には送らない）

import nodemailer from 'nodemailer';

const PROJECT = 'shareconnect-71706';
const API_KEY = 'AIzaSyApt0DIeMvelIlwTTXeTPz67yL1vdWoFnI'; // 公開Webクライアントキー（index.htmlと同一）
const APP_URL = 'https://seishokai.github.io/shareconnect/';

const GMAIL_USER = (process.env.GMAIL_USER || '').trim();
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').trim();
if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('GMAIL_USER / GMAIL_APP_PASSWORD が未設定です。リポジトリの Secrets に登録してください。');
  process.exit(1);
}
const mailer = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
});

// ── JSTの今日 ──
const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
const y = jstNow.getUTCFullYear();
const m = jstNow.getUTCMonth() + 1; // 1-12
const d = jstNow.getUTCDate();
const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = n => String(n).padStart(2, '0');

const force = process.env.FORCE === '1';
const testTo = (process.env.TEST_TO || '').trim();

if (!force && d !== lastDay && d !== lastDay - 1) {
  console.log(`JST ${y}-${pad(m)}-${pad(d)}: 月末(${lastDay}日)でも前日でもないため送信しません`);
  process.exit(0);
}
console.log(`JST ${y}-${pad(m)}-${pad(d)} (月末=${lastDay}日${force ? ', FORCE' : ''}) — リマインダー送信を開始`);

// ── Firestore REST の値デコード ──
function fv(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fv(x);
    return o;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fv);
  return null;
}

// ── スタッフ一覧取得（ページング対応） ──
async function fetchStaff() {
  const out = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/staff?pageSize=300&key=${API_KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
    const json = await res.json();
    for (const doc of json.documents || []) {
      const id = doc.name.split('/').pop();
      const f = {};
      for (const [k, v] of Object.entries(doc.fields || {})) f[k] = fv(v);
      out.push({ id, ...f });
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

// ── 当月すでに申請/締め済みか ──
function alreadyDone(staff) {
  const wd = staff.workData || {};
  const prefix = `${y}-${pad(m)}_`;
  for (const [k, md] of Object.entries(wd)) {
    if (k.startsWith(prefix) && md && (md.submitted || md.locked)) return true;
  }
  return false;
}

// ── メール本文 ──
function buildHtml(staff) {
  const url = `${APP_URL}?staff&id=${staff.id}`;
  const deadline = `${m}月${lastDay}日（月末）`;
  return `<html><head><meta charset="utf-8"></head><body style="font-family:'Hiragino Sans','Noto Sans JP',Meiryo,sans-serif;color:#333;max-width:560px;margin:0 auto;line-height:1.9">
  <div style="background:#1a1a1a;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;text-align:center">
    <h2 style="margin:0;font-size:17px;letter-spacing:.08em">稼働報告のお願い</h2>
    <p style="margin:4px 0 0;opacity:.8;font-size:12px">${y}年${m}月分</p>
  </div>
  <div style="border:1px solid #ddd;border-top:none;padding:22px 20px;border-radius:0 0 6px 6px;font-size:14px">
    <p style="margin:0 0 14px"><b>${staff.name} 様</b></p>
    <p style="margin:0 0 14px">お疲れさまです。シェアコネクト運営です。<br>
    ${y}年${m}月の稼働報告（勤怠入力）の締め切りが近づいています。<br>
    <b>${deadline}まで</b>に、以下のURLから今月の稼働内容をご入力のうえ、<b>「月締め申請」</b>をお願いいたします。<br>
    今月稼働がない場合は、このメールは無視していただいて大丈夫です☺</p>
    <p style="margin:18px 0;text-align:center">
      <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:bold">稼働入力ページを開く</a>
    </p>
    <p style="margin:0 0 6px;font-size:12px;color:#888;word-break:break-all">URLが開けない場合はこちら：<br>${url}</p>
    <p style="margin:16px 0 0;font-size:12px;color:#888">すでにご対応いただいている場合は、行き違いですのでご容赦ください。</p>
  </div>
  <p style="font-size:11px;color:#999;text-align:center;margin-top:12px">ShareConnect Auto Notification</p>
</body></html>`;
}

// ── 送信 ──
const staffList = await fetchStaff();
const targets = staffList.filter(s => s.approved && (s.email || '').includes('@') && !alreadyDone(s));
const skippedDone = staffList.filter(s => s.approved && alreadyDone(s)).map(s => s.name);
const skippedNoMail = staffList.filter(s => s.approved && !(s.email || '').includes('@')).map(s => s.name);

console.log(`スタッフ ${staffList.length}名 / 送信対象 ${targets.length}名`);
if (skippedDone.length) console.log(`申請・締め済みのためスキップ: ${skippedDone.join(', ')}`);
if (skippedNoMail.length) console.log(`メールアドレス未登録のためスキップ: ${skippedNoMail.join(', ')}`);

let sent = 0, failed = 0;
for (const s of targets) {
  const to = testTo || s.email;
  try {
    await mailer.sendMail({
      from: `シェアコネクト <${GMAIL_USER}>`,
      to,
      subject: `【稼働報告のお願い】${y}年${m}月分の入力をお願いします`,
      html: buildHtml(s)
    });
    sent++;
    console.log(`OK  ${s.name} -> ${to}`);
  } catch (e) {
    failed++;
    console.error(`NG  ${s.name} -> ${to}: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 500)); // 送信間隔
}

console.log(`完了: 送信 ${sent} / 失敗 ${failed}`);
if (failed > 0) process.exit(1);
