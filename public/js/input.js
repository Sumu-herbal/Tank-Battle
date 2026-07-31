/**
 * 坦克大战 - 输入处理
 * P1主: WASD 移动, J 射击, K 使用道具
 * P2副: 方向键 移动, . 射击, / 使用道具
 */

const Input = {
  keys: {},
  _justPressed: new Set(),

  // 触摸控件状态
  _touchDir: -1,
  _touchFire: false,
  _touchSkill: false,

  init() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (!this.keys[key]) this._justPressed.add(key);
      this.keys[key] = true;
      this.keys[e.code] = true;
      e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code] = false;
    });

    window.addEventListener('blur', () => {
      this.keys = {};
      this._justPressed.clear();
    });

    // 触摸控件
    this._initTouch();
  },

  _initTouch() {
    const joy = document.getElementById('touchJoystick');
    const knob = document.getElementById('touchJoyKnob');
    const fire = document.getElementById('touchFire');
    const skill = document.getElementById('touchSkill');
    if (!joy || !knob || !fire) return;

    let joyActive = false, joyId = null;
    const joyCX = 55, joyCY = 55, maxR = 42;

    const handleStart = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const rect = joy.getBoundingClientRect();
        const tx = t.clientX - rect.left, ty = t.clientY - rect.top;
        const dx = tx - joyCX, dy = ty - joyCY;
        if (Math.sqrt(dx*dx + dy*dy) < 55 && !joyActive) {
          joyActive = true; joyId = t.identifier;
          this._updateKnob(knob, tx, ty, joyCX, joyCY, maxR);
        }
      }
    };
    const handleMove = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          const rect = joy.getBoundingClientRect();
          this._updateKnob(knob, t.clientX - rect.left, t.clientY - rect.top, joyCX, joyCY, maxR);
        }
      }
    };
    const handleEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          joyActive = false; joyId = null; this._touchDir = -1;
          knob.style.transform = 'translate(-50%, -50%)';
        }
      }
    };

    joy.addEventListener('touchstart', handleStart, {passive:false});
    joy.addEventListener('touchmove', handleMove, {passive:false});
    joy.addEventListener('touchend', handleEnd);
    joy.addEventListener('touchcancel', handleEnd);

    fire.addEventListener('touchstart', (e) => { e.preventDefault(); this._touchFire = true; });
    fire.addEventListener('touchend', (e) => { e.preventDefault(); this._touchFire = false; });
    if (skill) {
      skill.addEventListener('touchstart', (e) => { e.preventDefault(); this._touchSkill = true; });
      skill.addEventListener('touchend', (e) => { e.preventDefault(); this._touchSkill = false; });
    }
  },

  _updateKnob(knob, tx, ty, cx, cy, maxR) {
    let dx = tx - cx, dy = ty - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // 方向判断（死区 12px）
    if (dist < 12) { this._touchDir = -1; return; }
    const angle = Math.atan2(dy, dx); // -PI..PI, 0=右
    if (angle < -2.35 || angle > 2.35) this._touchDir = DIR.RIGHT;
    else if (angle < -0.78) this._touchDir = DIR.UP;
    else if (angle < 0.78) this._touchDir = DIR.RIGHT;
    else if (angle < 1.57) this._touchDir = DIR.DOWN;
    else this._touchDir = DIR.LEFT;
  },

  update() {
    this._justPressed.clear();
  },

  isDown(key) { return !!this.keys[key.toLowerCase()]; },
  isCode(code) { return !!this.keys[code]; },
  wasPressed(key) { return this._justPressed.has(key.toLowerCase()); },

  // P1 主玩家输入（键盘 + 触摸）
  getP1Move() {
    if (this._touchDir >= 0) return this._touchDir;
    if (this.isDown('w') || this.isDown('arrowup')) return DIR.UP;
    if (this.isDown('s') || this.isDown('arrowdown')) return DIR.DOWN;
    if (this.isDown('a') || this.isDown('arrowleft')) return DIR.LEFT;
    if (this.isDown('d') || this.isDown('arrowright')) return DIR.RIGHT;
    return -1;
  },

  getP1Shoot() {
    return this.wasPressed('j') || this.isCode('Space');
  },

  isP1Shooting() {
    return this._touchFire || this.isCode('Space') || this.isDown('j');
  },

  getP1Powerup() {
    return this.wasPressed('k') || this._touchSkill;
  },

  // P2 副玩家输入
  getP2Move() {
    if (this.isDown('i')) return DIR.UP;
    if (this.isDown('k')) return DIR.DOWN;
    if (this.isDown('j')) return DIR.LEFT;
    if (this.isDown('l')) return DIR.RIGHT;
    return -1;
  },

  getP2Shoot() {
    return this.wasPressed('/') || this.wasPressed('.');
  }
};
