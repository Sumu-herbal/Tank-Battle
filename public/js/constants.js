/**
 * 坦克大战 - 游戏常量（革新版）
 */

// 地图
const TILE_SIZE = 24;
const MAP_COLS = 34;
const MAP_ROWS = 34;
const TANK_SPEED = 2;
const BULLET_SPEED = 5;

// 方向
const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };

// 瓦片类型 — 动态战场
const TILE = {
  EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, FOREST: 4, BASE: 5,
  MUD: 6,        // 泥泞：减速50%
  ICE: 7,        // 冰面：惯性滑行
  TALL_GRASS: 8, // 高草丛：隐身（开火时暴露）
};

// 坦克职业
const TANK_CLASS = {
  SHIELD:    { id:'shield',    name:'🛡️ 重装盾坦', hp:3, speed:1.5, skill:'盾牌格挡', skillCd:8000,  desc:'血量厚移速慢，技能：3秒正面无敌盾' },
  ASSASSIN:  { id:'assassin',  name:'🗡️ 刺客侦查', hp:1, speed:3.2, skill:'闪现冲刺', skillCd:5000,  desc:'极速移动，技能：向前瞬移一段距离' },
  ENGINEER:  { id:'engineer',  name:'🔧 工程控场', hp:2, speed:1.8, skill:'建造铁墙', skillCd:10000, desc:'布置地雷，技能：前方放置临时钢铁墙' },
  ARTILLERY: { id:'artillery', name:'💥 远程炮艇', hp:2, speed:1.6, skill:'蓄力重炮', skillCd:6000,  desc:'远程输出，技能：发射贯穿全图的蓄力炮' },
};

// 战场事件
const EVENTS = {
  AIRDROP:        { name:'📦 空投物资',   desc:'随机位置掉落3个道具' },
  SANDSTORM:      { name:'🌪️ 沙尘暴',    desc:'视野缩小60%，持续15秒' },
  ORBITAL_STRIKE: { name:'☄️ 轨道炮击',   desc:'随机区域红圈预警，3秒后轰炸' },
  DOUBLE_SPEED:   { name:'⚡ 超速狂潮',   desc:'所有单位移速翻倍，持续10秒' },
};

// 道具类型
const POWERUP_TYPES = {
  timeFreeze:    { name:'⏱️ 时间冻结', desc:'冻结所有敌人3秒',  color:'#00bfff', duration:3000,  icon:'❄️' },
  terrainEditor: { name:'🧱 地形编辑', desc:'基地周围生成钢铁掩体', color:'#ff8c00', duration:0,     icon:'🔧' },
  shield:        { name:'🛡️ 能量护盾', desc:'获得8秒无敌护盾',   color:'#ffd700', duration:8000,  icon:'✨' },
  rapidFire:     { name:'⚡ 急速射击', desc:'射速提升3倍10秒',    color:'#ff4444', duration:10000, icon:'🔥' },
  mine:          { name:'💣 反坦克雷', desc:'身后布置伪装地雷',   color:'#ff1493', duration:0,     icon:'💥' },
  ricochet:      { name:'🔄 弹射子弹', desc:'子弹可反弹3次15秒',  color:'#ff00ff', duration:15000, icon:'💫' },
  tripleShot:    { name:'🔱 三向散射', desc:'一次发射3颗子弹10秒',color:'#00ff88', duration:10000, icon:'🔱' },
};

// 坦克颜色 — 赛博朋克霓虹风
const TANK_COLORS = {
  player1:  { body:'#00e5ff', track:'#006080', barrel:'#40f0ff', glow:'#00e5ff' },
  player2:  { body:'#ff3366', track:'#801030', barrel:'#ff6688', glow:'#ff3366' },
  player3:  { body:'#39ff14', track:'#108000', barrel:'#66ff50', glow:'#39ff14' },
  player4:  { body:'#ffdd00', track:'#806e00', barrel:'#ffee55', glow:'#ffdd00' },
  player5:  { body:'#ff6b35', track:'#802a10', barrel:'#ff9a66', glow:'#ff6b35' },
  player6:  { body:'#e040fb', track:'#601080', barrel:'#f080ff', glow:'#e040fb' },
  player7:  { body:'#00e676', track:'#005020', barrel:'#66ffa6', glow:'#00e676' },
  player8:  { body:'#ffab00', track:'#805500', barrel:'#ffcc55', glow:'#ffab00' },
  shield:   { body:'#4488ff', track:'#1a3366', barrel:'#77bbff', glow:'#4488ff' },
  assassin: { body:'#cc44ff', track:'#501a66', barrel:'#dd88ff', glow:'#cc44ff' },
  engineer: { body:'#ff8822', track:'#663310', barrel:'#ffaa55', glow:'#ff8822' },
  artillery:{ body:'#ff2244', track:'#660a18', barrel:'#ff5577', glow:'#ff2244' },
};

const ROLE_NAMES = {
  rusher:'突击兵', flanker:'侧翼兵', defender:'守卫兵', scout:'侦察兵',
  shield:'盾坦', assassin:'刺客', engineer:'工程', artillery:'炮艇',
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TILE_SIZE, MAP_COLS, MAP_ROWS, TANK_SPEED, BULLET_SPEED, DIR, TILE, TANK_CLASS, EVENTS, POWERUP_TYPES, TANK_COLORS, ROLE_NAMES };
}
