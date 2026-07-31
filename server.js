/**
 * 坦克大战 - 局域网多人对战服务器
 * 权威服务器架构：服务端计算所有游戏逻辑，客户端负责渲染
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== 游戏常量 ====================
const TILE_SIZE = 24;
const MAP_COLS = 34;
const MAP_ROWS = 34;
const TANK_SPEED = 2;
const BULLET_SPEED = 5;
const MAX_PLAYERS = 8;
const TICK_RATE = 1000 / 30;     // 逻辑帧率 30 FPS
const BROADCAST_RATE = 1000 / 20; // 广播帧率 20 FPS（降低40%带宽）
const RECONNECT_GRACE = 120000;  // 断线保留状态 120 秒（页面刷新恢复）
const RESPAWN_TIME = 3000;
const POWERUP_SPAWN_INTERVAL = 15000;
const MAX_ENEMIES = 24;

const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
const TILE = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, FOREST: 4, BASE: 5, MUD: 6, ICE: 7, TALL_GRASS: 8 };
const ROLE_NAMES = { rusher:'突击兵', flanker:'侧翼兵', defender:'守卫兵', scout:'侦察兵',
  shield:'盾坦', assassin:'刺客', engineer:'工程', artillery:'炮艇' };

// 坦克职业定义
const TANK_CLASS = {
  shield:    { hp:3, speed:1.5, skill:'shield_block',   skillCd:8000  },
  assassin:  { hp:1, speed:3.2, skill:'blink_dash',      skillCd:5000  },
  engineer:  { hp:2, speed:1.8, skill:'build_wall',      skillCd:10000 },
  artillery: { hp:2, speed:1.6, skill:'charge_shot',     skillCd:6000  },
};

// 水果名字池
const FRUIT_NAMES = [
  '🍎苹果', '🍊橘子', '🍋柠檬', '🍇葡萄', '🍓草莓', '🍑桃子', '🍒樱桃', '🥝猕猴桃',
  '🍌香蕉', '🍉西瓜', '🍍菠萝', '🥭芒果', '🍈甜瓜', '🫐蓝莓', '🍐梨子', '🥥椰子',
  '🍅柿子', '🥑牛油果', '🍏青苹果', '🫒橄榄', '🍊蜜桔', '🍇提子', '🍓树莓', '🥭榴莲'
];
let usedFruitNames = [];

function getRandomFruitName() {
  const available = FRUIT_NAMES.filter(n => !usedFruitNames.includes(n));
  if (available.length === 0) {
    // 所有名字都用过了，重置
    usedFruitNames = [];
    return FRUIT_NAMES[Math.floor(Math.random() * FRUIT_NAMES.length)];
  }
  const name = available[Math.floor(Math.random() * available.length)];
  usedFruitNames.push(name);
  return name;
}

function releaseFruitName(name) {
  usedFruitNames = usedFruitNames.filter(n => n !== name);
}

// ==================== HTTP + WebSocket 服务器 ====================
const server = http.createServer((req, res) => {
  // 防止路径遍历攻击
  let reqPath = req.url.split('?')[0]; // 去掉查询参数
  if (reqPath === '/') reqPath = '/index.html';
  // 过滤危险字符，只允许字母数字/.-_
  reqPath = reqPath.replace(/\.\./g, '').replace(/[^a-zA-Z0-9\/\.\-_]/g, '');
  let filePath = path.join(__dirname, 'public', reqPath);
  // 确保文件在 public 目录内
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// WebSocket 心跳检测
const HEARTBEAT_INTERVAL = 30000;
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws._alive === false) {
      // 上次 ping 没收到 pong → 断开
      console.log('💔 心跳超时，断开连接');
      return ws.terminate();
    }
    // 标记待检测，发 ping
    ws._alive = false;
    try { ws.ping(); } catch(e) {}
  });
}, HEARTBEAT_INTERVAL);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 坦克大战服务器已启动！`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  console.log(`   局域网访问: http://${getLocalIP()}:${PORT}`);
  console.log(`   等待玩家连接...`);
});

function getLocalIP() {
  const { networkInterfaces } = require('os');
  for (const name of Object.keys(networkInterfaces())) {
    for (const net of networkInterfaces()[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// ==================== 游戏状态 ====================
class GameState {
  constructor() {
    this.players = {};        // { playerId: PlayerState }
    this.enemies = [];        // EnemyTank[]
    this.bullets = [];        // Bullet[]
    this.powerups = [];       // PowerUp[]
    this.map = null;          // 2D tile array
    this.wave = 1;
    this.enemiesRemaining = 0;
    this.enemiesSpawned = 0;
    this.baseAlive = true;
    this.gameOver = false;
    this.powerupTimer = 0;
    this.spawnQueue = [];
    this.playerBehaviorProfiles = {}; // { playerId: BehaviorProfile }
    this.eventTimer = 45000;
    this.activeEvent = null;
    this.activeEventTimer = 0;
    this.orbitalTargets = [];
    this.initMap();
  }

  initMap() {
    this.map = [];
    for (let row = 0; row < MAP_ROWS; row++) {
      this.map[row] = new Array(MAP_COLS).fill(TILE.EMPTY);
    }
  }

  generateMap(levelData) {
    this.initMap();
    const { bricks, steels, waters, forests, muds, ices, tallGrasses, basePos } = levelData;

    // 放置基地
    this.map[basePos.row][basePos.col] = TILE.BASE;
    // 基地围墙
    for (let r = basePos.row - 1; r <= basePos.row + 1; r++) {
      for (let c = basePos.col - 1; c <= basePos.col + 1; c++) {
        if (r === basePos.row && c === basePos.col) continue;
        if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS) {
          this.map[r][c] = TILE.BRICK;
        }
      }
    }

    // 放置砖块
    for (const b of bricks) {
      if (b.row < MAP_ROWS && b.col < MAP_COLS && this.map[b.row][b.col] === TILE.EMPTY) {
        this.map[b.row][b.col] = TILE.BRICK;
      }
    }

    // 放置钢铁
    for (const s of steels) {
      if (s.row < MAP_ROWS && s.col < MAP_COLS && this.map[s.row][s.col] === TILE.EMPTY) {
        this.map[s.row][s.col] = TILE.STEEL;
      }
    }

    // 放置水域
    for (const w of waters) {
      if (w.row < MAP_ROWS && w.col < MAP_COLS && this.map[w.row][w.col] === TILE.EMPTY) {
        this.map[w.row][w.col] = TILE.WATER;
      }
    }

    // 放置森林
    for (const f of forests) {
      if (f.row < MAP_ROWS && f.col < MAP_COLS && this.map[f.row][f.col] === TILE.EMPTY) {
        this.map[f.row][f.col] = TILE.FOREST;
      }
    }
    // 放置泥泞
    if (muds) for (const m of muds) {
      if (m.row < MAP_ROWS && m.col < MAP_COLS && this.map[m.row][m.col] === TILE.EMPTY) {
        this.map[m.row][m.col] = TILE.MUD;
      }
    }
    // 放置冰面
    if (ices) for (const i of ices) {
      if (i.row < MAP_ROWS && i.col < MAP_COLS && this.map[i.row][i.col] === TILE.EMPTY) {
        this.map[i.row][i.col] = TILE.ICE;
      }
    }
    // 放置高草丛
    if (tallGrasses) for (const g of tallGrasses) {
      if (g.row < MAP_ROWS && g.col < MAP_COLS && this.map[g.row][g.col] === TILE.EMPTY) {
        this.map[g.row][g.col] = TILE.TALL_GRASS;
      }
    }
  }

  spawnPlayer(playerId, fruitName, tankClass) {
    const spawn = this.getRandomSpawn();
    const cls = TANK_CLASS[tankClass] ? tankClass : 'shield';
    const cfg = TANK_CLASS[cls];
    this.players[playerId] = {
      id: playerId,
      name: fruitName || getRandomFruitName(),
      class: cls,
      x: spawn.col * TILE_SIZE + TILE_SIZE / 2,
      y: spawn.row * TILE_SIZE + TILE_SIZE / 2,
      dir: DIR.UP,
      alive: true,
      hp: cfg.hp,
      maxHp: cfg.hp,
      speed: cfg.speed,
      skill: cfg.skill,
      skillCd: cfg.skillCd,
      skillReady: true,
      skillTimer: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      shieldActive: true,
      shieldTimer: 5000,
      rapidFire: false,
      rapidFireTimer: 0,
      speedBoost: 0,
      speedTimer: 0,
      ricochetBullets: false,
      ricochetTimer: 0,
      tripleShot: false,
      tripleTimer: 0,
      invisible: false,
      onIce: false,
      iceInertia: null, // {x,y} 冰面惯性方向
      frontShield: false,
      frontShieldTimer: 0,
      sessionToken: 'st_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 10),
      disconnectedAt: 0,
      disconnectTimeout: null,
    };
    if (!this.playerBehaviorProfiles[playerId]) {
      this.playerBehaviorProfiles[playerId] = { aggression: 0.5, defense: 0.5, mobility: 0.5 };
    }
    return spawn;
  }

  getPlayerSpawns() {
    return [
      { row: 0, col: 4 },
      { row: 0, col: 12 },
      { row: 0, col: 20 },
      { row: 12, col: 0 },
      { row: 12, col: MAP_COLS - 1 },
      { row: MAP_ROWS - 1, col: 4 },
      { row: MAP_ROWS - 1, col: 20 },
      { row: MAP_ROWS - 1, col: 12 },
    ];
  }

  // 随机出生点：在地图四周区域随机找空地（8人版）
  getRandomSpawn() {
    const zones = [
      { rMin: 1, rMax: 4, cMin: 1, cMax: 6 },       // 左上
      { rMin: 1, rMax: 4, cMin: MAP_COLS-7, cMax: MAP_COLS-2 }, // 右上
      { rMin: 1, rMax: 4, cMin: Math.floor(MAP_COLS/2)-3, cMax: Math.floor(MAP_COLS/2)+3 }, // 上中
      { rMin: MAP_ROWS-5, rMax: MAP_ROWS-2, cMin: 1, cMax: 6 }, // 左下
      { rMin: MAP_ROWS-5, rMax: MAP_ROWS-2, cMin: MAP_COLS-7, cMax: MAP_COLS-2 }, // 右下
      { rMin: MAP_ROWS-5, rMax: MAP_ROWS-2, cMin: Math.floor(MAP_COLS/2)-3, cMax: Math.floor(MAP_COLS/2)+3 }, // 下中
      { rMin: Math.floor(MAP_ROWS/2)-2, rMax: Math.floor(MAP_ROWS/2)+2, cMin: 1, cMax: 4 }, // 左中
      { rMin: Math.floor(MAP_ROWS/2)-2, rMax: Math.floor(MAP_ROWS/2)+2, cMin: MAP_COLS-5, cMax: MAP_COLS-2 }, // 右中
    ];

    // 随机选一个区域，在该区域内找空地
    const shuffled = zones.sort(() => Math.random() - 0.5);
    for (const zone of shuffled) {
      const candidates = [];
      for (let r = zone.rMin; r <= zone.rMax; r++) {
        for (let c = zone.cMin; c <= zone.cMax; c++) {
          if (this.map[r] && this.map[r][c] === TILE.EMPTY) {
            // 确保不与其他坦克位置重叠
            const cx = c * TILE_SIZE + TILE_SIZE / 2;
            const cy = r * TILE_SIZE + TILE_SIZE / 2;
            const tooClose = [...Object.values(this.players), ...this.enemies].some(t =>
              t.alive && Math.abs(t.x - cx) < TILE_SIZE * 2 && Math.abs(t.y - cy) < TILE_SIZE * 2
            );
            if (!tooClose) candidates.push({ row: r, col: c });
          }
        }
      }
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    // 兜底：全图随机找
    for (let attempt = 0; attempt < 100; attempt++) {
      const r = 2 + Math.floor(Math.random() * (MAP_ROWS - 5));
      const c = 2 + Math.floor(Math.random() * (MAP_COLS - 5));
      if (this.map[r] && this.map[r][c] === TILE.EMPTY) {
        return { row: r, col: c };
      }
    }
    return { row: 2, col: 4 }; // 终极兜底
  }

  spawnEnemy(role = null) {
    const spawns = [
      { row: 0, col: 0 }, { row: 0, col: MAP_COLS - 1 },
      { row: 0, col: Math.floor(MAP_COLS / 2) }, { row: MAP_ROWS - 1, col: 0 },
      { row: MAP_ROWS - 1, col: MAP_COLS - 1 }, { row: MAP_ROWS - 1, col: Math.floor(MAP_COLS / 2) }
    ];
    // 检查出生点是否被占用
    const available = spawns.filter(s => {
      return !this.enemies.some(e => e.alive && Math.abs(e.x - (s.col * TILE_SIZE + TILE_SIZE/2)) < TILE_SIZE
        && Math.abs(e.y - (s.row * TILE_SIZE + TILE_SIZE/2)) < TILE_SIZE);
    });
    if (available.length === 0) return null;

    const spawn = available[Math.floor(Math.random() * available.length)];
    const roles = ['flanker', 'rusher', 'defender', 'scout'];
    const assignedRole = role || roles[Math.floor(Math.random() * roles.length)];

    const enemy = {
      id: 'enemy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      x: spawn.col * TILE_SIZE + TILE_SIZE / 2,
      y: spawn.row * TILE_SIZE + TILE_SIZE / 2,
      dir: DIR.DOWN,
      alive: true,
      role: assignedRole,
      hp: 1,
      speed: TANK_SPEED * (0.8 + Math.random() * 0.4),
      ai: new EnemyAI(assignedRole),
      shootCooldown: 0,
      moveTimer: 0,
      stuckTimer: 0,
      lastX: 0,
      lastY: 0,
      targetX: null,
      targetY: null,
      state: 'spawn' // spawn, patrol, attack, flank, retreat
    };
    this.enemies.push(enemy);
    this.enemiesSpawned++;
    return enemy;
  }

  fireBullet(tank, isPlayer = true, dirOverride = null) {
    const offset = TILE_SIZE / 2;
    const dir = dirOverride !== null ? dirOverride : tank.dir;
    let bx = tank.x, by = tank.y;
    switch (dir) {
      case DIR.UP: by -= offset; break;
      case DIR.RIGHT: bx += offset; break;
      case DIR.DOWN: by += offset; break;
      case DIR.LEFT: bx -= offset; break;
    }
    // 反弹次数（仅玩家可弹射）
    const maxBounces = (isPlayer && tank.ricochetBullets) ? 3 : 0;
    this.bullets.push({
      id: 'bullet_' + Date.now() + Math.random(),
      x: bx, y: by, dir: dir,
      speed: BULLET_SPEED,
      isPlayer: isPlayer,
      ownerId: tank.id,
      bounces: 0,
      maxBounces: maxBounces,
    });
  }

  // ==================== 碰撞检测 ====================
  checkTileCollision(x, y, isBullet = false) {
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return { collides: true, tile: -1 };

    const tile = this.map[row][col];
    // 可通行地形（坦克和子弹都可通过）
    if (tile === TILE.EMPTY || tile === TILE.FOREST || tile === TILE.MUD || tile === TILE.ICE || tile === TILE.TALL_GRASS) {
      return { collides: false, tile, row, col };
    }
    if (tile === TILE.WATER) return { collides: !isBullet, tile, row, col };
    if (tile === TILE.STEEL) return { collides: true, tile, row, col };
    if (tile === TILE.BRICK) return { collides: true, tile, row, col, destructible: true };
    if (tile === TILE.BASE) return { collides: true, tile, row, col, isBase: true };

    return { collides: false, tile, row, col };
  }

  checkTankTileCollision(tank) {
    const halfSize = TILE_SIZE / 2 - 2;
    const corners = [
      { x: tank.x - halfSize, y: tank.y - halfSize },
      { x: tank.x + halfSize, y: tank.y - halfSize },
      { x: tank.x - halfSize, y: tank.y + halfSize },
      { x: tank.x + halfSize, y: tank.y + halfSize }
    ];
    for (const c of corners) {
      const result = this.checkTileCollision(c.x, c.y);
      if (result.collides) return result;
    }
    return { collides: false };
  }

  // 坦克之间碰撞（玩家vs玩家、玩家vs敌人、敌人vs敌人）
  checkTankVsTankCollision(tank, excludeId) {
    const allTanks = [
      ...Object.values(this.players).filter(p => p.alive && p.id !== excludeId),
      ...this.enemies.filter(e => e.alive && e.id !== excludeId)
    ];
    const minDist = TILE_SIZE * 0.9;
    for (const other of allTanks) {
      const dist = Math.sqrt((tank.x - other.x) ** 2 + (tank.y - other.y) ** 2);
      if (dist < minDist) return true;
    }
    return false;
  }

  // ==================== 游戏更新 ====================
  update(dt) {
    if (this.gameOver) return;

    // 定期清理死亡敌人（防止内存泄漏 - 最多保留100个敌人槽位）
    this.enemies = this.enemies.filter(e => e.alive);
    if (this.enemies.length > 100) {
      this.enemies.splice(0, this.enemies.length - 100);
    }

    // 更新玩家
    for (const pid in this.players) {
      const p = this.players[pid];
      if (!p.alive) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) this.respawnPlayer(pid);
        continue;
      }
      // 道具/技能计时器
      if (p.shieldActive) { p.shieldTimer -= dt; if (p.shieldTimer <= 0) p.shieldActive = false; }
      if (p.rapidFire) { p.rapidFireTimer -= dt; if (p.rapidFireTimer <= 0) p.rapidFire = false; }
      if (p.speedBoost > 0) { p.speedTimer -= dt; if (p.speedTimer <= 0) p.speedBoost = 0; }
      if (p.ricochetBullets) { p.ricochetTimer -= dt; if (p.ricochetTimer <= 0) p.ricochetBullets = false; }
      if (p.tripleShot) { p.tripleTimer -= dt; if (p.tripleTimer <= 0) p.tripleShot = false; }
      if (!p.skillReady) { p.skillTimer -= dt; if (p.skillTimer <= 0) { p.skillReady = true; p.skillTimer = 0; } }
      if (p.frontShield) { p.frontShieldTimer -= dt; if (p.frontShieldTimer <= 0) p.frontShield = false; }

      // 地形效果检测
      const tileCol = Math.floor(p.x / TILE_SIZE);
      const tileRow = Math.floor(p.y / TILE_SIZE);
      const curTile = (this.map[tileRow] && this.map[tileRow][tileCol]) || TILE.EMPTY;

      // 草丛隐身
      p.invisible = (curTile === TILE.TALL_GRASS);
      // 冰面标记
      p.onIce = (curTile === TILE.ICE);
      // 泥泞减速 — 由 handleMessage 中的移动逻辑处理
    }

    // 更新敌人AI
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.shootCooldown -= dt;
      enemy.moveTimer -= dt;
      enemy.ai.update(this, enemy, dt);
    }

    // 限制子弹总数防止内存溢出
    if (this.bullets.length > 200) {
      this.bullets.splice(0, this.bullets.length - 200);
    }

    // 更新子弹
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const dx = [0, BULLET_SPEED, 0, -BULLET_SPEED][b.dir];
      const dy = [-BULLET_SPEED, 0, BULLET_SPEED, 0][b.dir];
      b.x += dx;
      b.y += dy;

      // 边界检查
      if (b.x < 0 || b.x >= MAP_COLS * TILE_SIZE || b.y < 0 || b.y >= MAP_ROWS * TILE_SIZE) {
        this.bullets.splice(i, 1);
        continue;
      }

      // 砖块/基地碰撞（含反弹）
      const tileCheck = this.checkTileCollision(b.x, b.y, true);
      if (tileCheck.collides) {
        if (tileCheck.destructible) {
          this.map[tileCheck.row][tileCheck.col] = TILE.EMPTY;
          this.bullets.splice(i, 1); continue;
        }
        if (tileCheck.isBase) {
          this.map[tileCheck.row][tileCheck.col] = TILE.EMPTY;
          this.baseAlive = false; this.gameOver = true;
          this.bullets.splice(i, 1); continue;
        }
        // 钢铁墙 → 尝试反弹
        if (tileCheck.tile === TILE.STEEL && b.bounces < b.maxBounces) {
          b.bounces++;
          // 根据击中墙的方向翻转弹道
          const cx = (tileCheck.col + 0.5) * TILE_SIZE;
          const cy = (tileCheck.row + 0.5) * TILE_SIZE;
          if (Math.abs(b.x - cx) > Math.abs(b.y - cy)) {
            b.dir = (b.dir === DIR.RIGHT) ? DIR.LEFT : DIR.RIGHT;
          } else {
            b.dir = (b.dir === DIR.DOWN) ? DIR.UP : DIR.DOWN;
          }
          // 回退一步避免卡墙
          b.x -= [0, BULLET_SPEED, 0, -BULLET_SPEED][b.dir];
          b.y -= [-BULLET_SPEED, 0, BULLET_SPEED, 0][b.dir];
          continue;
        }
        this.bullets.splice(i, 1); continue;
      }

      // 坦克碰撞
      let hit = false;
      if (b.isPlayer) {
        // 玩家子弹 → 打敌人
        for (const enemy of this.enemies) {
          if (!enemy.alive) continue;
          if (Math.abs(b.x - enemy.x) < TILE_SIZE / 2 && Math.abs(b.y - enemy.y) < TILE_SIZE / 2) {
            enemy.alive = false;
            enemy.hp = 0;
            hit = true;
            // 给开火的玩家加分
            let killerName = '';
            for (const pid in this.players) {
              if (this.players[pid].id === b.ownerId) {
                this.players[pid].score += 100;
                this.players[pid].kills++;
                killerName = this.players[pid].name;
              }
            }
            this.enemiesRemaining--;
            broadcast({ type:'killFeed', killer:killerName, victim:ROLE_NAMES[enemy.role]||enemy.role });
            break;
          }
        }
        // 玩家子弹 → 打其他玩家 (PvP)
        if (!hit) {
          for (const pid in this.players) {
            const p = this.players[pid];
            if (!p.alive || p.id === b.ownerId) continue; // 不打自己
            if (Math.abs(b.x - p.x) < TILE_SIZE / 2 && Math.abs(b.y - p.y) < TILE_SIZE / 2) {
              if (p.shieldActive) { hit = true; break; }
              p.alive = false;
              p.deaths++;
              p.respawnTimer = RESPAWN_TIME;
              hit = true;
              // 击杀者加分 + 播报
              let kn = '';
              for (const opid in this.players) {
                if (this.players[opid].id === b.ownerId) {
                  this.players[opid].score += 150;
                  this.players[opid].kills++;
                  kn = this.players[opid].name;
                }
              }
              broadcast({ type:'killFeed', killer:kn, victim:p.name });
              break;
            }
          }
        }
      } else {
        // 敌人子弹 → 打玩家
        for (const pid in this.players) {
          const p = this.players[pid];
          if (!p.alive) continue;
          if (Math.abs(b.x - p.x) < TILE_SIZE / 2 && Math.abs(b.y - p.y) < TILE_SIZE / 2) {
            if (p.shieldActive) { hit = true; break; }
            p.alive = false;
            p.deaths++;
            p.respawnTimer = RESPAWN_TIME;
            hit = true;
            break;
          }
        }
      }
      if (hit) { this.bullets.splice(i, 1); }
    }

    // 战场事件更新
    this.updateEvents(dt);

    // 更新道具生成
    this.powerupTimer -= dt;
    const pc = Object.keys(this.players).length || 1;
    const maxPowerups = Math.min(5, 2 + Math.ceil(pc / 2)); // 按人数缩放，封顶5
    if (this.powerupTimer <= 0 && this.powerups.length < maxPowerups) {
      this.spawnPowerup();
      this.powerupTimer = POWERUP_SPAWN_INTERVAL;
    }

    // 道具碰撞检测
    for (const pid in this.players) {
      const p = this.players[pid];
      if (!p.alive) continue;
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pu = this.powerups[i];
        if (Math.abs(p.x - pu.x) < TILE_SIZE && Math.abs(p.y - pu.y) < TILE_SIZE) {
          this.applyPowerup(p, pu.type);
          this.powerups.splice(i, 1);
        }
      }
    }

    // 检查波次
    const aliveEnemies = this.enemies.filter(e => e.alive).length;
    if (aliveEnemies === 0 && this.enemiesSpawned >= this.getWaveEnemyCount()) {
      this.startNewWave();
    }
    // 补充敌人 — 随玩家数动态调整刷新速率
    const playerCount = Object.keys(this.players).length || 1;
    const maxAlive = 4 + playerCount * 2; // 8人时最多20个敌人同时在场
    if (aliveEnemies < maxAlive && this.enemiesSpawned < this.getWaveEnemyCount()) {
      if (Math.random() < 0.04 * playerCount / 4) this.spawnEnemy();
    }
  }

  getWaveEnemyCount() {
    const playerCount = Object.keys(this.players).length || 1;
    return (6 + this.wave * 3) * playerCount; // 8人×波1=72 敌人
  }

  startNewWave() {
    this.wave++;
    this.enemiesRemaining = this.getWaveEnemyCount();
    this.enemiesSpawned = 0;
    // 立即刷新一波敌人
    const pc = Object.keys(this.players).length || 1;
    for (let i = 0; i < Math.min(5 + pc, this.enemiesRemaining); i++) {
      this.spawnEnemy();
    }
  }

  respawnPlayer(pid) {
    const p = this.players[pid];
    p.alive = true;
    const spawn = this.getRandomSpawn();
    p.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    p.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    p.dir = DIR.UP;
    p.shieldActive = true;
    p.shieldTimer = 5000; // 5秒无敌
  }

  spawnPowerup() {
    const types = ['timeFreeze', 'terrainEditor', 'shield', 'rapidFire', 'mine'];
    const type = types[Math.floor(Math.random() * types.length)];
    // 找一个空地
    let row, col, attempts = 0;
    do {
      row = Math.floor(Math.random() * (MAP_ROWS - 4)) + 2;
      col = Math.floor(Math.random() * (MAP_COLS - 4)) + 2;
      attempts++;
    } while (this.map[row][col] !== TILE.EMPTY && attempts < 50);

    this.powerups.push({
      id: 'pu_' + Date.now(),
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
      type: type
    });
  }

  applyPowerup(player, type) {
    const p = player;
    switch (type) {
      case 'timeFreeze':
        // 冻结所有敌人3秒
        for (const enemy of this.enemies) {
          enemy.frozen = true;
          enemy.frozenTimer = 3000;
        }
        p.score += 50;
        break;
      case 'terrainEditor':
        // 在基地周围生成钢铁墙
        this.placeTerrainEditorWalls();
        p.score += 75;
        break;
      case 'shield':
        p.shieldActive = true;
        p.shieldTimer = 8000;
        p.score += 30;
        break;
      case 'rapidFire':
        p.rapidFire = true;
        p.rapidFireTimer = 10000;
        p.score += 40;
        break;
      case 'mine':
        // 在玩家身后放置地雷（一触即死的砖块伪装）
        this.placeMine(p);
        p.score += 60;
        break;
    }
  }

  placeTerrainEditorWalls() {
    // 找到基地位置并在周围放置额外钢铁墙
    let baseR = -1, baseC = -1;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (this.map[r][c] === TILE.BASE) { baseR = r; baseC = c; break; }
      }
    }
    if (baseR < 0) return;
    const positions = [
      { r: baseR - 2, c: baseC - 2 }, { r: baseR - 2, c: baseC + 2 },
      { r: baseR + 2, c: baseC - 2 }, { r: baseR + 2, c: baseC + 2 }
    ];
    for (const pos of positions) {
      if (pos.r >= 0 && pos.r < MAP_ROWS && pos.c >= 0 && pos.c < MAP_COLS) {
        if (this.map[pos.r][pos.c] === TILE.EMPTY) {
          this.map[pos.r][pos.c] = TILE.STEEL;
        }
      }
    }
  }

  // ===== 职业技能 =====
  activateSkill(player) {
    switch (player.skill) {
      case 'shield_block':
        player.frontShield = true;
        player.frontShieldTimer = 3000;
        break;
      case 'blink_dash':
        const dashDist = TILE_SIZE * 4;
        const rad = (player.dir * Math.PI) / 2;
        const dx = Math.cos(rad) * dashDist;
        const dy = -Math.sin(rad) * dashDist;
        const nx = player.x + dx, ny = player.y + dy;
        const col = this.checkTankTileCollision({ x: nx, y: ny });
        if (!col.collides) { player.x = nx; player.y = ny; }
        break;
      case 'build_wall':
        this.placeWallInFront(player);
        break;
      case 'charge_shot':
        // 贯穿炮：发射一颗高速长距离子弹
        const bullet = this.fireBullet(player, true);
        const b = this.bullets[this.bullets.length - 1];
        if (b) b.speed = BULLET_SPEED * 2;
        break;
    }
  }

  placeWallInFront(player) {
    let bx = Math.floor(player.x / TILE_SIZE);
    let by = Math.floor(player.y / TILE_SIZE);
    switch (player.dir) {
      case DIR.UP: by -= 2; break;
      case DIR.DOWN: by += 2; break;
      case DIR.LEFT: bx -= 2; break;
      case DIR.RIGHT: bx += 2; break;
    }
    if (by >= 0 && by < MAP_ROWS && bx >= 0 && bx < MAP_COLS && this.map[by][bx] === TILE.EMPTY) {
      this.map[by][bx] = TILE.STEEL;
      // 10秒后自动消失
      setTimeout(() => {
        if (this.map[by] && this.map[by][bx] === TILE.STEEL) this.map[by][bx] = TILE.EMPTY;
      }, 10000);
    }
  }

  // ===== 随机战场事件 =====
  updateEvents(dt) {
    this.eventTimer -= dt;
    if (this.activeEvent) {
      this.activeEventTimer -= dt;
      if (this.activeEventTimer <= 0) {
        this.activeEvent = null;
        broadcast({ type: 'eventEnd', event: this.activeEvent });
      }
      // 轨道炮3秒后引爆
      if (this.activeEvent === 'orbital_strike' && this.activeEventTimer < (15000 - 3000)) {
        for (const t of this.orbitalTargets) {
          this._orbitalStrike(t.x, t.y);
        }
        this.orbitalTargets = [];
      }
      return;
    }
    if (this.eventTimer <= 0) {
      this.triggerRandomEvent();
      this.eventTimer = 45000 + Math.random() * 30000;
    }
  }

  triggerRandomEvent() {
    const events = ['airdrop', 'sandstorm', 'orbital_strike', 'double_speed'];
    const evt = events[Math.floor(Math.random() * events.length)];
    this.activeEvent = evt;
    this.activeEventTimer = 15000;

    switch (evt) {
      case 'airdrop':
        for (let i = 0; i < 3; i++) this.spawnPowerup();
        break;
      case 'orbital_strike':
        this.orbitalTargets = [];
        for (let i = 0; i < 3; i++) {
          this.orbitalTargets.push({
            x: (3 + Math.random() * (MAP_COLS - 6)) * TILE_SIZE,
            y: (3 + Math.random() * (MAP_ROWS - 6)) * TILE_SIZE,
          });
        }
        break;
    }
    broadcast({ type: 'battleEvent', event: evt, targets: this.orbitalTargets, timer: 15000 });
  }

  _orbitalStrike(x, y) {
    // 范围伤害
    for (const pid in this.players) {
      const p = this.players[pid];
      if (!p.alive) continue;
      if (Math.abs(p.x - x) < TILE_SIZE * 3 && Math.abs(p.y - y) < TILE_SIZE * 3) {
        p.alive = false; p.deaths++; p.respawnTimer = RESPAWN_TIME;
      }
    }
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      if (Math.abs(enemy.x - x) < TILE_SIZE * 3 && Math.abs(enemy.y - y) < TILE_SIZE * 3) {
        enemy.alive = false; this.enemiesRemaining--;
      }
    }
    // 破坏地形
    for (let r = Math.floor((y - TILE_SIZE*3) / TILE_SIZE); r <= Math.floor((y + TILE_SIZE*3) / TILE_SIZE); r++) {
      for (let c = Math.floor((x - TILE_SIZE*3) / TILE_SIZE); c <= Math.floor((x + TILE_SIZE*3) / TILE_SIZE); c++) {
        if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS && this.map[r][c] === TILE.BRICK) {
          this.map[r][c] = TILE.EMPTY;
        }
      }
    }
  }

  placeMine(player) {
    const bx = Math.floor(player.x / TILE_SIZE);
    const by = Math.floor(player.y / TILE_SIZE);
    const offsetDirs = [
      { r: by - 1, c: bx }, { r: by + 1, c: bx },
      { r: by, c: bx - 1 }, { r: by, c: bx + 1 }
    ];
    for (const pos of offsetDirs) {
      if (pos.r >= 0 && pos.r < MAP_ROWS && pos.c >= 0 && pos.c < MAP_COLS) {
        if (this.map[pos.r][pos.c] === TILE.EMPTY) {
          this.map[pos.r][pos.c] = TILE.BRICK;
          // 标记为地雷（在map元数据中）
          if (!this.mines) this.mines = {};
          this.mines[`${pos.r},${pos.c}`] = true;
          break;
        }
      }
    }
  }

  getState() {
    return {
      players: this.players,
      enemies: this.enemies.filter(e => e.alive).map(e => ({
        id: e.id, x: e.x, y: e.y, dir: e.dir, role: e.role, alive: e.alive, frozen: e.frozen || false,
        speed: e.speed || TANK_SPEED,
      })),
      bullets: this.bullets,
      powerups: this.powerups,
      map: this.map,
      wave: this.wave,
      baseAlive: this.baseAlive,
      gameOver: this.gameOver,
      enemiesRemaining: this.enemiesRemaining,
      activeEvent: this.activeEvent,
      activeEventTimer: this.activeEventTimer,
      orbitalTargets: this.orbitalTargets,
    };
  }
}

// ==================== 敌人AI行为树 ====================
class EnemyAI {
  constructor(role) {
    this.role = role;
    this.state = 'patrol';
    this.stateTimer = 0;
    this.targetPath = [];
    this.personality = {
      aggression: 0.3 + Math.random() * 0.7,
      caution: 0.3 + Math.random() * 0.7,
      coordination: 0.3 + Math.random() * 0.7
    };
  }

  update(gameState, self, dt) {
    if (!self.alive || self.frozen) {
      if (self.frozen) { self.frozenTimer -= dt; if (self.frozenTimer <= 0) self.frozen = false; }
      return;
    }

    // 检查是否卡住
    if (Math.abs(self.x - self.lastX) < 0.5 && Math.abs(self.y - self.lastY) < 0.5) {
      self.stuckTimer += dt;
    } else {
      self.stuckTimer = 0;
    }
    self.lastX = self.x;
    self.lastY = self.y;

    // ===== 行为树执行 =====
    this.executeBehaviorTree(gameState, self, dt);
  }

  executeBehaviorTree(gameState, self, dt) {
    // 优先级1: 检测基地威胁 → 防御
    if (this.detectBaseThreat(gameState, self)) {
      this.state = 'defend';
      this.moveTowardBase(gameState, self);
      this.tryShoot(gameState, self);
      return;
    }

    // 优先级2: 检测道具 → 收集
    const nearbyPowerup = this.detectPowerup(gameState, self);
    if (nearbyPowerup && Math.random() < this.personality.aggression) {
      this.state = 'collect';
      this.moveToward(gameState, self, nearbyPowerup.x, nearbyPowerup.y);
      return;
    }

    // 优先级3: 敌人在射程内 → 攻击
    const target = this.findNearestPlayer(gameState, self);
    if (target && this.distanceTo(self, target) < TILE_SIZE * 8) {
      this.state = 'attack';
      this.attackTarget(gameState, self, target);
      return;
    }

    // 优先级4: 按角色执行战术（卡住600ms强制换目标）
    this.stateTimer -= dt;
    if (this.stateTimer <= 0 || self.stuckTimer > 600) {
      this.stateTimer = 1000 + Math.random() * 2000;
      if (self.stuckTimer > 600) {
        // 卡住了：清空目标路径，让下次行为重新计算
        self.targetX = null;
        self.targetY = null;
        // 随机换方向避免死循环
        self.dir = Math.floor(Math.random() * 4);
      }
      self.stuckTimer = 0;
      this.executeRoleBehavior(gameState, self);
    }
  }

  detectBaseThreat(gameState, self) {
    // 如果有玩家接近基地
    let baseR = -1, baseC = -1;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (gameState.map[r][c] === TILE.BASE) { baseR = r; baseC = c; break; }
      }
    }
    if (baseR < 0) return false;

    const baseX = baseC * TILE_SIZE + TILE_SIZE / 2;
    const baseY = baseR * TILE_SIZE + TILE_SIZE / 2;

    for (const pid in gameState.players) {
      const p = gameState.players[pid];
      if (!p.alive) continue;
      if (Math.abs(p.x - baseX) < TILE_SIZE * 6 && Math.abs(p.y - baseY) < TILE_SIZE * 6) {
        return true;
      }
    }
    return false;
  }

  detectPowerup(gameState, self) {
    let closest = null, minDist = TILE_SIZE * 5;
    for (const pu of gameState.powerups) {
      const dist = this.distanceTo(self, pu);
      if (dist < minDist) { minDist = dist; closest = pu; }
    }
    return closest;
  }

  findNearestPlayer(gameState, self) {
    let closest = null, minDist = Infinity;
    for (const pid in gameState.players) {
      const p = gameState.players[pid];
      if (!p.alive) continue;
      const dist = this.distanceTo(self, p);
      if (dist < minDist) { minDist = dist; closest = p; }
    }
    return closest;
  }

  attackTarget(gameState, self, target) {
    this.moveToward(gameState, self, target.x, target.y);
    this.tryShoot(gameState, self);
  }

  executeRoleBehavior(gameState, self) {
    switch (self.role) {
      case 'flanker':
        this.flankerBehavior(gameState, self);
        break;
      case 'rusher':
        this.rusherBehavior(gameState, self);
        break;
      case 'defender':
        this.defenderBehavior(gameState, self);
        break;
      case 'scout':
        this.scoutBehavior(gameState, self);
        break;
    }
  }

  flankerBehavior(gameState, self) {
    // 侧翼包抄：移动到玩家侧后方
    const target = this.findNearestPlayer(gameState, self);
    if (target) {
      const flankX = target.x + (Math.random() > 0.5 ? 1 : -1) * TILE_SIZE * 6;
      const flankY = target.y + (Math.random() > 0.5 ? 1 : -1) * TILE_SIZE * 4;
      this.moveToward(gameState, self, flankX, flankY);
      if (this.distanceTo(self, target) < TILE_SIZE * 8) {
        this.tryShoot(gameState, self);
      }
    } else {
      this.patrol(gameState, self);
    }
  }

  rusherBehavior(gameState, self) {
    // 正面佯攻/突击：冲向基地
    let baseR = -1, baseC = -1;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (gameState.map[r][c] === TILE.BASE) { baseR = r; baseC = c; break; }
      }
    }
    if (baseR >= 0) {
      this.moveToward(gameState, self, baseC * TILE_SIZE + TILE_SIZE / 2, baseR * TILE_SIZE + TILE_SIZE / 2);
    }
    // 路上遇到玩家就射击
    const target = this.findNearestPlayer(gameState, self);
    if (target && this.distanceTo(self, target) < TILE_SIZE * 6) {
      this.tryShoot(gameState, self);
    }
  }

  defenderBehavior(gameState, self) {
    // 防守：在基地周围巡逻
    let baseR = -1, baseC = -1;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (gameState.map[r][c] === TILE.BASE) { baseR = r; baseC = c; break; }
      }
    }
    if (baseR >= 0) {
      const patrolRadius = TILE_SIZE * 4;
      const angle = Date.now() / 2000 + parseInt(self.id.match(/\d+/)?.[0] || 0);
      const px = (baseC * TILE_SIZE + TILE_SIZE / 2) + Math.cos(angle) * patrolRadius;
      const py = (baseR * TILE_SIZE + TILE_SIZE / 2) + Math.sin(angle) * patrolRadius;
      this.moveToward(gameState, self, px, py);
    }
    const target = this.findNearestPlayer(gameState, self);
    if (target && this.distanceTo(self, target) < TILE_SIZE * 6) {
      this.tryShoot(gameState, self);
    }
  }

  scoutBehavior(gameState, self) {
    // 侦察：在地图上移动，发现玩家
    if (!self.targetX || this.distanceTo(self, { x: self.targetX, y: self.targetY }) < TILE_SIZE) {
      self.targetX = Math.random() * MAP_COLS * TILE_SIZE;
      self.targetY = Math.random() * MAP_ROWS * TILE_SIZE;
    }
    this.moveToward(gameState, self, self.targetX, self.targetY);
    const target = this.findNearestPlayer(gameState, self);
    if (target && this.distanceTo(self, target) < TILE_SIZE * 5) {
      this.tryShoot(gameState, self);
    }
  }

  patrol(gameState, self) {
    if (!self.targetX || this.distanceTo(self, { x: self.targetX, y: self.targetY }) < TILE_SIZE) {
      self.targetX = Math.random() * MAP_COLS * TILE_SIZE;
      self.targetY = Math.random() * MAP_ROWS * TILE_SIZE;
    }
    this.moveToward(gameState, self, self.targetX, self.targetY);
  }

  moveTowardBase(gameState, self) {
    let baseR = -1, baseC = -1;
    for (let r = 0; r < MAP_ROWS; r++)
      for (let c = 0; c < MAP_COLS; c++)
        if (gameState.map[r][c] === TILE.BASE) { baseR = r; baseC = c; break; }
    if (baseR >= 0) {
      this.moveToward(gameState, self, baseC * TILE_SIZE + TILE_SIZE / 2, baseR * TILE_SIZE + TILE_SIZE / 2);
    }
  }

  moveToward(gameState, self, tx, ty) {
    const dx = tx - self.x;
    const dy = ty - self.y;
    const speed = self.speed * (self.frozen ? 0 : 1);

    // 按优先级排列移动方向：[主轴向, 副轴向, 主反向, 副反向]
    let dirs = [];
    if (Math.abs(dx) > Math.abs(dy)) {
      dirs = [
        { d: dx > 0 ? DIR.RIGHT : DIR.LEFT, mx: Math.sign(dx) * speed, my: 0 },
        { d: dy > 0 ? DIR.DOWN : DIR.UP, mx: 0, my: Math.sign(dy) * speed },
        { d: dy > 0 ? DIR.UP : DIR.DOWN, mx: 0, my: -Math.sign(dy) * speed },
        { d: dx > 0 ? DIR.LEFT : DIR.RIGHT, mx: -Math.sign(dx) * speed, my: 0 },
      ];
    } else {
      dirs = [
        { d: dy > 0 ? DIR.DOWN : DIR.UP, mx: 0, my: Math.sign(dy) * speed },
        { d: dx > 0 ? DIR.RIGHT : DIR.LEFT, mx: Math.sign(dx) * speed, my: 0 },
        { d: dx > 0 ? DIR.LEFT : DIR.RIGHT, mx: -Math.sign(dx) * speed, my: 0 },
        { d: dy > 0 ? DIR.UP : DIR.DOWN, mx: 0, my: -Math.sign(dy) * speed },
      ];
    }

    // 尝试每个方向，选第一个能走的
    for (const dir of dirs) {
      const nx = self.x + dir.mx;
      const ny = self.y + dir.my;
      const tileCollision = gameState.checkTankTileCollision({ x: nx, y: ny });
      const tankCollision = gameState.checkTankVsTankCollision({ x: nx, y: ny }, self.id);
      if (!tileCollision.collides && !tankCollision) {
        self.x = nx;
        self.y = ny;
        self.dir = dir.d;
        self._lastValidDir = dir.d;
        return;
      }
    }

    // 全堵住了：尝试前进方向（即使卡墙也蹭一蹭）
    // 沿当前方向尝试半步
    const halfSpeed = speed * 0.6;
    const rad = (self.dir * Math.PI) / 2;
    const hx = self.x + Math.cos(rad) * halfSpeed;
    const hy = self.y - Math.sin(rad) * halfSpeed;
    const hCollision = gameState.checkTankTileCollision({ x: hx, y: hy });
    if (!hCollision.collides) {
      self.x = hx;
      self.y = hy;
    }
    // 完全卡死 → stuckTimer 会在 update 里触发重新选目标
  }

  tryShoot(gameState, self) {
    if (self.shootCooldown > 0) return;
    // 检查是否有友军在弹道上
    self.shootCooldown = 800 + Math.random() * 1200;
    gameState.fireBullet(self, false);
  }

  distanceTo(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
}

// ==================== 关卡生成器 ====================
class LevelGenerator {
  constructor() {
    this.defaultLevel = {
      bricks: [],
      steels: [],
      waters: [],
      forests: [],
      basePos: { row: MAP_ROWS - 2, col: Math.floor(MAP_COLS / 2) }
    };
  }

  generate(behaviorProfiles = {}, wave = 1) {
    const level = {
      bricks: [],
      steels: [],
      waters: [],
      forests: [],
      muds: [],
      ices: [],
      tallGrasses: [],
      basePos: { row: MAP_ROWS - 2, col: Math.floor(MAP_COLS / 2) }
    };

    // 聚合玩家行为数据
    let avgAggression = 0.5, avgDefense = 0.5, avgMobility = 0.5;
    const profiles = Object.values(behaviorProfiles);
    if (profiles.length > 0) {
      avgAggression = profiles.reduce((s, p) => s + (p.aggression || 0.5), 0) / profiles.length;
      avgDefense = profiles.reduce((s, p) => s + (p.defense || 0.5), 0) / profiles.length;
      avgMobility = profiles.reduce((s, p) => s + (p.mobility || 0.5), 0) / profiles.length;
    }

    const difficulty = Math.min(1, wave / 10);

    // 砖块密度随难度增加，分布受玩家行为影响
    const brickDensity = 0.12 + difficulty * 0.15;
    // 激进型玩家 → 更多开放空间（砖块少）
    // 防守型玩家 → 更多掩体和通道
    const aggressionMod = 1 - avgAggression * 0.3;

    const totalBricks = Math.floor(MAP_ROWS * MAP_COLS * brickDensity * aggressionMod);
    for (let i = 0; i < totalBricks; i++) {
      const r = Math.floor(Math.random() * (MAP_ROWS - 4)) + 2;
      const c = Math.floor(Math.random() * (MAP_COLS - 4)) + 2;
      // 不要覆盖基地
      if (Math.abs(r - level.basePos.row) <= 2 && Math.abs(c - level.basePos.col) <= 2) continue;
      level.bricks.push({ row: r, col: c });
    }

    // 钢铁墙：防守型玩家多给钢铁掩体
    const steelCount = Math.floor(8 + avgDefense * 20 + difficulty * 5);
    for (let i = 0; i < steelCount; i++) {
      const r = Math.floor(Math.random() * (MAP_ROWS - 4)) + 2;
      const c = Math.floor(Math.random() * (MAP_COLS - 4)) + 2;
      if (Math.abs(r - level.basePos.row) <= 2 && Math.abs(c - level.basePos.col) <= 2) continue;
      level.steels.push({ row: r, col: c });
    }

    // 水域：激进型玩家 → 更多水域（增加战术深度）
    const waterPatches = Math.floor(2 + (1 - avgAggression) * 3 + difficulty * 1);
    for (let p = 0; p < waterPatches; p++) {
      const pr = Math.floor(Math.random() * (MAP_ROWS - 8)) + 4;
      const pc = Math.floor(Math.random() * (MAP_COLS - 8)) + 4;
      for (let r = pr; r < pr + 2 + Math.floor(Math.random() * 3); r++) {
        for (let c = pc; c < pc + 2; c++) {
          if (r < MAP_ROWS && c < MAP_COLS && this.isFarFromBase(r, c, level.basePos)) {
            level.waters.push({ row: r, col: c });
          }
        }
      }
    }

    // 森林：机动型玩家 → 更多森林（提供隐蔽）
    const forestClusters = Math.floor(3 + avgMobility * 5);
    for (let p = 0; p < forestClusters; p++) {
      const pr = Math.floor(Math.random() * (MAP_ROWS - 6)) + 3;
      const pc = Math.floor(Math.random() * (MAP_COLS - 6)) + 3;
      for (let r = pr; r < pr + 2; r++) {
        for (let c = pc; c < pc + 2 + Math.floor(Math.random() * 3); c++) {
          if (r < MAP_ROWS && c < MAP_COLS && this.isFarFromBase(r, c, level.basePos)) {
            level.forests.push({ row: r, col: c });
          }
        }
      }
    }

    // 泥泞地带：2-4片，减速区域
    const mudPatches = 2 + Math.floor(Math.random() * 3);
    for (let p = 0; p < mudPatches; p++) {
      const mr = Math.floor(Math.random() * (MAP_ROWS - 6)) + 3;
      const mc = Math.floor(Math.random() * (MAP_COLS - 6)) + 3;
      for (let r = mr; r < mr + 2; r++)
        for (let c = mc; c < mc + 2 + Math.floor(Math.random() * 2); c++)
          if (r < MAP_ROWS && c < MAP_COLS && this.isFarFromBase(r, c, level.basePos))
            level.muds.push({ row: r, col: c });
    }

    // 冰面：1-3条冰路，提供惯性滑行
    const icePaths = 1 + Math.floor(Math.random() * 3);
    for (let p = 0; p < icePaths; p++) {
      const ir = Math.floor(Math.random() * (MAP_ROWS - 8)) + 4;
      const ic = Math.floor(Math.random() * (MAP_COLS - 6)) + 3;
      const horizontal = Math.random() > 0.5;
      for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) {
        const r = horizontal ? ir : ir + i;
        const c = horizontal ? ic + i : ic;
        if (r < MAP_ROWS && c < MAP_COLS && this.isFarFromBase(r, c, level.basePos))
          level.ices.push({ row: r, col: c });
      }
    }

    // 高草丛：3-5簇，提供隐身
    const grassClusters = 3 + Math.floor(Math.random() * 3);
    for (let p = 0; p < grassClusters; p++) {
      const gr = Math.floor(Math.random() * (MAP_ROWS - 4)) + 2;
      const gc = Math.floor(Math.random() * (MAP_COLS - 4)) + 2;
      for (let r = gr; r < Math.min(gr + 2, MAP_ROWS); r++)
        for (let c = gc; c < Math.min(gc + 2, MAP_COLS); c++)
          if (this.isFarFromBase(r, c, level.basePos))
            level.tallGrasses.push({ row: r, col: c });
    }

    // 高难度：在关键通道放置钢铁墙
    if (difficulty > 0.5) {
      const centerCol = Math.floor(MAP_COLS / 2);
      for (let r = 6; r < MAP_ROWS - 6; r += 4) {
        level.steels.push({ row: r, col: centerCol - 3 });
        level.steels.push({ row: r, col: centerCol + 3 });
      }
    }

    return level;
  }

  isFarFromBase(r, c, basePos) {
    return Math.abs(r - basePos.row) > 3 || Math.abs(c - basePos.col) > 3;
  }
}

// ==================== 服务器主循环 ====================
const game = new GameState();
const levelGen = new LevelGenerator();

// 初始化第一关
const firstLevel = levelGen.generate({}, 1);
game.generateMap(firstLevel);
game.enemiesRemaining = game.getWaveEnemyCount();
for (let i = 0; i < 5; i++) game.spawnEnemy();
game.powerupTimer = POWERUP_SPAWN_INTERVAL;

let lastTick = Date.now();
// 逻辑循环 30 FPS
setInterval(() => {
  try {
    const now = Date.now();
    const dt = Math.min(now - lastTick, 100);
    lastTick = now;
    game.update(dt);
  } catch(e) {
    console.error('💥 逻辑异常:', e.message);
  }
}, TICK_RATE);

// 广播循环 20 FPS（分离逻辑与网络，降40% I/O）
setInterval(() => {
  try { broadcastGameState(); } catch(e) { console.error('💥 广播异常:', e.message); }
}, BROADCAST_RATE);

// ==================== WebSocket 消息处理 ====================
wss.on('connection', (ws) => {
  // 心跳
  ws._alive = true;
  ws.on('pong', () => { ws._alive = true; });

  // 缓冲首条消息，用于判断是否重连
  let firstMsg = null;
  ws._msgQueue = [];

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!firstMsg) {
        firstMsg = msg;
        handleFirstMessage(ws, msg);
      } else {
        handleMessage(ws, msg);
      }
    } catch (e) { /* 忽略无效消息 */ }
  });

  ws.on('close', () => {
    const pid = ws.playerId;
    const name = ws.fruitName || '???';
    console.log(`👋 玩家断开: ${name}`);
    if (pid && game.players[pid]) {
      const p = game.players[pid];
      // 清除旧定时器
      if (p.disconnectTimeout) clearTimeout(p.disconnectTimeout);
      // 标记断线时间，但保持 alive=true（宽限期内可重连）
      p.disconnectedAt = Date.now();
      // 广播断线（不是离开，其他玩家可以看到该玩家变灰）
      broadcast({ type: 'playerDisconnected', playerId: pid, playerName: name });
      broadcast({ type: 'chat', playerId: 'system', message: `${name} 断线了...`, isSystem: true });
      // 120秒后彻底移除
      p.disconnectTimeout = setTimeout(() => {
        if (game.players[pid] && game.players[pid].disconnectedAt > 0) {
          console.log(`⏰ 重连超时，移除: ${game.players[pid].name}`);
          releaseFruitName(game.players[pid].name);
          delete game.players[pid];
          delete game.playerBehaviorProfiles[pid];
          broadcast({ type: 'playerLeft', playerId: pid, playerName: name,
            playerCount: Object.values(game.players).filter(p => p.alive || p.disconnectedAt === 0).length });
        }
      }, RECONNECT_GRACE);
    }
  });
});

function handleFirstMessage(ws, msg) {
  // 重连处理：首条消息是 reconnect → 尝试恢复旧玩家
  if (msg.type === 'reconnect' && msg.playerId && msg.sessionToken) {
    const old = game.players[msg.playerId];
    if (old && old.disconnectedAt > 0 && old.sessionToken === msg.sessionToken) {
      // 验证通过，恢复玩家
      if (old.disconnectTimeout) clearTimeout(old.disconnectTimeout);
      old.disconnectTimeout = null;
      old.disconnectedAt = 0;
      old.shieldActive = true;
      old.shieldTimer = 5000;
      ws.playerId = msg.playerId;
      ws.fruitName = old.name;
      console.log(`🔄 玩家重连: ${old.name} (${msg.playerId})`);
      // 发送 init + 完整状态快照
      ws.send(JSON.stringify({
        type: 'init', playerId: msg.playerId, playerName: old.name,
        sessionToken: old.sessionToken, mapData: game.map, reconnect: true
      }));
      // 紧接着发送完整游戏状态（hydrate）
      ws.send(JSON.stringify({
        type: 'hydrate', data: game.getState(), playerId: msg.playerId
      }));
      broadcast({ type: 'playerReconnected', playerId: msg.playerId, playerName: old.name,
        playerCount: Object.values(game.players).filter(p => p.alive || p.disconnectedAt === 0).length });
      broadcast({ type: 'chat', playerId: 'system', message: `${old.name} 重连了！`, isSystem: true });
      return;
    }
    // 重连失败：令牌不匹配或玩家已被清理
    if (!old || old.disconnectedAt === 0) {
      ws.send(JSON.stringify({ type: 'error', message: '重连失败：会话已过期，请重新加入' }));
    } else {
      ws.send(JSON.stringify({ type: 'error', message: '重连失败：令牌无效' }));
    }
    // 给客户端一点时间接收错误消息再关闭
    setTimeout(() => { try { ws.close(); } catch(e) {} }, 500);
    return;
  }

  // 检查人数上限（排除已断线的玩家）
  const activeCount = Object.values(game.players).filter(p => p.alive || p.disconnectedAt === 0).length;
  if (activeCount >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'error', message: '服务器已满' }));
    ws.close();
    return;
  }

  // 新玩家
  const playerId = 'p' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  const fruitName = getRandomFruitName();
  console.log(`👤 新玩家: ${fruitName} (${playerId})`);

  const spawn = game.spawnPlayer(playerId, fruitName);
  const sessionToken = game.players[playerId].sessionToken;
  ws.playerId = playerId;
  ws.fruitName = fruitName;

  ws.send(JSON.stringify({
    type: 'init', playerId, playerName: fruitName,
    sessionToken, mapData: game.map, spawn
  }));

  const playerCount = Object.values(game.players).filter(p => p.alive || p.disconnectedAt === 0).length;
  const extraEnemies = 4 + playerCount * 2;
  for (let i = 0; i < extraEnemies; i++) game.spawnEnemy();
  game.enemiesRemaining += extraEnemies;

  broadcast({ type: 'playerJoined', playerId, playerName: fruitName, playerCount });
  broadcast({ type: 'chat', playerId: 'system', message: `${fruitName} 加入了战斗！`, isSystem: true });
}

function handleMessage(ws, msg) {
  const playerId = ws.playerId;
  const player = game.players[playerId];
  if (!player) return;

  // 消息频率限制
  const now = Date.now();
  if (!ws._lastMsgTime) ws._lastMsgTime = 0;
  if (!ws._msgCount) ws._msgCount = 0;

  // 每秒最多60条消息
  if (now - ws._lastMsgTime > 1000) { ws._msgCount = 0; ws._lastMsgTime = now; }
  ws._msgCount++;
  if (ws._msgCount > 60) return; // 超频则丢弃

  switch (msg.type) {
    // reconnect 已在 handleFirstMessage 中处理，这里不重复

    case 'move':
      if (!player.alive) break;
      // dir: -1 = 停止移动（客户端松键优化），0-3 = 正常方向
      if (typeof msg.dir !== 'number' || msg.dir < -1 || msg.dir > 3) break;
      if (msg.dir === -1) break; // 停止移动，不需要处理

      // 泥泞减速50%
      const tileCol = Math.floor(player.x / TILE_SIZE);
      const tileRow = Math.floor(player.y / TILE_SIZE);
      const curTile = (game.map[tileRow] && game.map[tileRow][tileCol]) || TILE.EMPTY;
      const inMud = (curTile === TILE.MUD);
      let speed = (player.speed || TANK_SPEED) + (player.speedBoost || 0);
      if (inMud) speed *= 0.5;

      let newX = player.x, newY = player.y;
      switch (msg.dir) {
        case DIR.UP: newY -= speed; player.dir = DIR.UP; break;
        case DIR.RIGHT: newX += speed; player.dir = DIR.RIGHT; break;
        case DIR.DOWN: newY += speed; player.dir = DIR.DOWN; break;
        case DIR.LEFT: newX -= speed; player.dir = DIR.LEFT; break;
      }

      const testTank = { x: newX, y: newY };
      const tileCollision = game.checkTankTileCollision(testTank);
      const tankCollision = game.checkTankVsTankCollision(testTank, playerId);
      if (!tileCollision.collides && !tankCollision) {
        player.x = newX;
        player.y = newY;
      }

      // 冰面惯性：继续滑行
      if (player.onIce && !tileCollision.collides && !tankCollision) {
        let ix = player.x, iy = player.y;
        switch (player.dir) {
          case DIR.UP: iy -= speed * 0.8; break;
          case DIR.DOWN: iy += speed * 0.8; break;
          case DIR.LEFT: ix -= speed * 0.8; break;
          case DIR.RIGHT: ix += speed * 0.8; break;
        }
        const iCollision = game.checkTankTileCollision({ x: ix, y: iy });
        const iTank = game.checkTankVsTankCollision({ x: ix, y: iy }, playerId);
        if (!iCollision.collides && !iTank) {
          player.x = ix; player.y = iy;
        }
      }

      // 草丛中开火后暴露
      if (player.invisible && player._lastShoot && Date.now() - player._lastShoot < 500) {
        player.invisible = false;
        setTimeout(() => { if (player.alive) player.invisible = true; }, 2000);
      }

      updateBehaviorProfile(playerId, 'move', { x: player.x, y: player.y });
      break;

    case 'shoot':
      if (!player.alive) break;
      const shootCd = player.rapidFire ? 180 : (player.class === 'artillery' ? 800 : 450);
      if (!player._lastShoot) player._lastShoot = 0;
      if (Date.now() - player._lastShoot < shootCd) break;
      player._lastShoot = Date.now();

      // 三向散射
      if (player.tripleShot) {
        game.fireBullet(player, true, player.dir);
        game.fireBullet(player, true, (player.dir + 1) % 4);
        game.fireBullet(player, true, (player.dir + 3) % 4);
      } else {
        game.fireBullet(player, true);
      }
      // 草丛开火暴露
      if (player.invisible) player.invisible = false;
      updateBehaviorProfile(playerId, 'shoot', { x: player.x, y: player.y });
      break;

    case 'skill':
      if (!player.alive || !player.skillReady) break;
      player.skillReady = false;
      player.skillTimer = player.skillCd;
      game.activateSkill(player);
      break;

    case 'setName':
      if (msg.name && msg.name.length <= 8) {
        releaseFruitName(player.name);
        player.name = msg.name;
        ws.fruitName = msg.name;
      }
      break;

    case 'chat':
      broadcast({ type: 'chat', playerId, playerName: player.name, message: msg.message.substring(0, 100) });
      break;
  }
}

function updateBehaviorProfile(playerId, action, pos) {
  if (!game.playerBehaviorProfiles[playerId]) {
    game.playerBehaviorProfiles[playerId] = { aggression: 0.5, defense: 0.5, mobility: 0.5 };
  }
  const profile = game.playerBehaviorProfiles[playerId];

  // 射击频率 → 侵略性
  if (action === 'shoot') {
    profile.aggression = Math.min(1, profile.aggression + 0.05);
    profile.shootCount = (profile.shootCount || 0) + 1;
  }

  // 离基地距离 → 防守倾向
  let baseR = -1, baseC = -1;
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c = 0; c < MAP_COLS; c++)
      if (game.map[r][c] === TILE.BASE) { baseR = r; baseC = c; break; }
  if (baseR >= 0) {
    const distToBase = Math.sqrt((pos.x/MAP_COLS - baseC/MAP_COLS)**2 + (pos.y/MAP_ROWS - baseR/MAP_ROWS)**2);
    profile.defense = profile.defense * 0.9 + (1 - Math.min(1, distToBase)) * 0.1;
  }

  // 移动量 → 机动性
  if (action === 'move') {
    profile.mobility = Math.min(1, profile.mobility + 0.01);
    profile.moveCount = (profile.moveCount || 0) + 1;
  }
}

function broadcast(data) {
  // 一次序列化，发给所有客户端
  const str = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(str); } catch (e) { /* 忽略发送失败 */ }
    }
  });
}

// 游戏主循环中的状态广播也复用这个逻辑
function broadcastGameState() {
  const stateStr = JSON.stringify({ type: 'gameState', data: game.getState() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(stateStr); } catch (e) { /* 忽略 */ }
    }
  });
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n🛑 收到退出信号，正在关闭服务器...');
  wss.clients.forEach(client => {
    client.send(JSON.stringify({ type: 'serverShutdown', message: '服务器正在关闭' }));
    client.close();
  });
  wss.close(() => {
    server.close(() => {
      console.log('✅ 服务器已安全关闭');
      process.exit(0);
    });
  });
  // 5秒强制退出
  setTimeout(() => { process.exit(0); }, 5000);
});

// 波次切换时重新生成地图
const originalStartNewWave = game.startNewWave.bind(game);
game.startNewWave = function() {
  originalStartNewWave();
  const newLevel = levelGen.generate(game.playerBehaviorProfiles, game.wave);
  game.generateMap(newLevel);
  broadcast({ type: 'newWave', wave: game.wave, levelData: newLevel });
};

// ===== 全局异常兜底 =====
process.on('uncaughtException', (err) => {
  console.error('💥 未捕获异常:', err.message);
  // 不退出进程，让 PM2 判断是否需要重启
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 未处理Promise:', reason);
});

console.log('✅ 服务器初始化完成');
