'use strict';

const TOPICS = [
  '打烊之后，最后一盏灯',
  '第一场雪落在窗沿上',
  '一杯凉掉的咖啡',
  '旧照片背面没有写完的字',
  '雨天里没有带伞的人',
  '凌晨四点还亮着的窗口',
  '一封没有寄出的信',
  '店门口的风铃响了一下',
  '跨年之前，最后一桌客人',
  '把一件旧物放回抽屉',
  '在车站等一班晚点的车',
  '夏夜里忽然停电',
  '一个人吃完的生日蛋糕',
  '从书里掉出来的一张车票',
  '多年以后又路过那条街',
  '没有告别的搬家',
  '深夜便利店的热饮柜',
  '一个不肯关灯的夜晚',
  '春天来之前，最后一次烤火',
  '在海边捡到一只旧杯子'
];

const KIND_CYCLE = ['recommend', 'story', 'essay', 'story', 'letter', 'recommend'];

function isoWeekday(d) {
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

class Scheduler {
  constructor({ getSettings, onFire }) {
    this.getSettings = getSettings;
    this.onFire = onFire;
    this.timer = null;
    this.running = false;
    this.lastRun = '';
    this.startedAt = 0;
  }

  settings() {
    const s = this.getSettings() || {};
    return s.schedule || {};
  }

  computeNext(now = new Date()) {
    const cfg = this.settings();
    if (!cfg.enabled) return null;
    const [hh, mm] = String(cfg.time || '21:30').split(':').map(n => parseInt(n, 10));
    const weekdays = Array.isArray(cfg.weekdays) && cfg.weekdays.length ? cfg.weekdays.map(Number) : [1, 2, 3, 4, 5, 6, 7];
    for (let offset = 0; offset < 8; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hh || 21, mm || 30, 0, 0);
      if (d.getTime() <= now.getTime() + 3000) continue;
      if (!weekdays.includes(isoWeekday(d))) continue;
      return d;
    }
    return null;
  }

  start() {
    this.stop();
    this.startedAt = Date.now();
    const cfg = this.settings();
    if (!cfg.enabled) return;
    const next = this.computeNext();
    if (!next) return;
    const delay = Math.max(1000, next.getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire('scheduled');
    }, Math.min(delay, 24 * 3600 * 1000));

    // Catch-up: if today's slot already passed while the app was closed.
    if (cfg.catchUp) {
      const [hh, mm] = String(cfg.time || '21:30').split(':').map(n => parseInt(n, 10));
      const todaySlot = new Date(nowYear(), nowMonth(), nowDate(), hh || 21, mm || 30, 0, 0);
      const last = cfg.lastRun ? new Date(cfg.lastRun).getTime() : 0;
      const days = Array.isArray(cfg.weekdays) && cfg.weekdays.length ? cfg.weekdays.map(Number) : [1, 2, 3, 4, 5, 6, 7];
      if (todaySlot.getTime() < Date.now() - 60 * 1000
        && last < todaySlot.getTime()
        && days.includes(isoWeekday(new Date()))) {
        setTimeout(() => this.fire('catchup'), 20000);
      }
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async fire(reason) {
    if (this.running) return;
    this.running = true;
    try {
      await this.onFire({ reason, topic: this.pickTopic(), kind: this.pickKind(), date: new Date() });
      this.lastRun = new Date().toISOString();
    } catch (e) {
      // The caller reports failures through its own notification.
      console.error('[scheduler]', e && e.message);
    } finally {
      this.running = false;
      if (this.settings().enabled) this.start();
    }
  }

  pickTopic() {
    const start = new Date(new Date().getFullYear(), 0, 0);
    const day = Math.floor((Date.now() - start.getTime()) / 86400000);
    return TOPICS[day % TOPICS.length];
  }

  pickKind() {
    const cfg = this.settings();
    if (cfg.kind && cfg.kind !== 'mixed') return cfg.kind;
    const start = new Date(new Date().getFullYear(), 0, 0);
    const day = Math.floor((Date.now() - start.getTime()) / 86400000);
    return KIND_CYCLE[day % KIND_CYCLE.length];
  }

  status() {
    const next = this.computeNext();
    return {
      enabled: !!this.settings().enabled,
      time: this.settings().time || '21:30',
      weekdays: this.settings().weekdays || [1, 2, 3, 4, 5, 6, 7],
      next: next ? next.toISOString() : '',
      running: this.running,
      lastRun: this.settings().lastRun || ''
    };
  }
}

function nowYear() { return new Date().getFullYear(); }
function nowMonth() { return new Date().getMonth(); }
function nowDate() { return new Date().getDate(); }

module.exports = { Scheduler, TOPICS };
