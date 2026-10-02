/**
 * LudoSoundManager - zero-asset synth engine (Web Audio API).
 * const sfx = new LudoSoundManager(); sfx.playDiceRoll(); sfx.toggleMute();
 * AudioContext is created lazily and resumed on the first user gesture (autoplay policy).
 */
class LudoSoundManager {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('ludo-muted') === '1';
    const evs = ['pointerdown', 'keydown', 'touchstart'];
    const unlock = () => { this._ensure(); evs.forEach(e => window.removeEventListener(e, unlock)); };
    evs.forEach(e => window.addEventListener(e, unlock, { passive: true }));
  }
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate / 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  toggleMute() { this.muted = !this.muted; localStorage.setItem('ludo-muted', this.muted ? '1' : '0'); return this.muted; }

  _tone(freq, t0, dur, { type = 'sine', vol = 0.3, slideTo = null } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  _noise(t0, dur, { freq = 2000, q = 1, vol = 0.3, type = 'bandpass' } = {}) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t0, Math.random() * 0.3); s.stop(t0 + dur);
  }
  _go(fn) { if (this.muted || !this._ensure()) return; fn(this.ctx.currentTime + 0.01); }

  /** Rattling taps that slow down, then a landing thump (~0.9s). */
  playDiceRoll() {
    this._go(t => {
      let at = t;
      for (let i = 0; i < 9; i++) {
        this._noise(at, 0.05, { freq: 1800 + Math.random() * 2500, q: 4, vol: 0.25 });
        this._tone(500 + Math.random() * 400, at, 0.04, { type: 'square', vol: 0.05 });
        at += 0.045 + i * 0.012;
      }
      this._tone(160, at + 0.03, 0.18, { slideTo: 50, vol: 0.5 });
      this._noise(at + 0.03, 0.12, { freq: 400, type: 'lowpass', vol: 0.4 });
    });
  }
  playTokenMove() { this._go(t => this._tone(700, t, 0.07, { type: 'triangle', vol: 0.25, slideTo: 420 })); }
  playTokenCapture() {
    this._go(t => {
      this._tone(300, t, 0.25, { type: 'sawtooth', vol: 0.35, slideTo: 60 });
      this._tone(120, t, 0.3, { type: 'square', vol: 0.3, slideTo: 40 });
      this._noise(t, 0.15, { freq: 900, vol: 0.4 });
    });
  }
  playSafeZone() { this._go(t => { this._tone(880, t, 0.25, { vol: 0.25 }); this._tone(1318.5, t + 0.12, 0.4, { vol: 0.25 }); }); }
  playHome() {
    this._go(t => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this._tone(f, t + i * 0.09, i === 3 ? 0.5 : 0.15, { type: 'square', vol: 0.15 })));
  }
  playWin() {
    this._go(t => {
      [[523.25, 0], [523.25, .15], [523.25, .3], [659.25, .5], [783.99, .7], [659.25, .9], [783.99, 1.05], [1046.5, 1.3]]
        .forEach(([f, d], i) => {
          const dur = i === 7 ? 1 : 0.2;
          this._tone(f, t + d, dur, { type: 'square', vol: 0.18 });
          this._tone(f / 2, t + d, dur, { type: 'triangle', vol: 0.2 });
        });
    });
  }
}
if (typeof module !== 'undefined') module.exports = LudoSoundManager;
