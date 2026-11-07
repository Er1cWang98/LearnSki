import type { Lesson } from '../domain/types';

// Titles and sequence follow the user screenshot. Teaching and criteria are editorial drafts.
export const lessons: Lesson[] = [
  {
    id: 'intro-01', stageId: 'intro', order: 1, optional: false, prerequisiteIds: [],
    version: 1, reviewStatus: 'draft', title: '单板滑雪装备介绍',
    goal: '编辑草稿：认识雪板、固定器、雪鞋和护具，能在练习前逐项检查装备。',
    steps: [
      '请教练或场地工作人员示范雪板、固定器、雪鞋和头盔的名称与用途，并认识板腰、板长和侧切等基本术语。',
      '对照自己的装备，确认雪鞋、固定器和头盔适配并正确穿戴。',
      '练习前查看装备是否有明显松动或损坏，有疑问时停止使用并请工作人员检查。',
    ],
    keyPoints: ['装备检查先于上雪练习。', '不确定固定器是否扣牢时先求助。'],
    commonMistakes: ['只认识雪板而忽略头盔和固定器。', '发现松动仍继续练习。'],
    criteria: [
      { id: 'intro-01-name', text: '能指出雪板、固定器、雪鞋和头盔。' },
      { id: 'intro-01-check', text: '能在练习前说明并完成装备检查。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-02', stageId: 'intro', order: 2, optional: false, prerequisiteIds: ['intro-01'],
    version: 1, reviewStatus: 'draft', title: '滑行的基本站姿',
    goal: '编辑草稿：在平坦、安全的位置建立可保持平衡的基本站姿。',
    steps: [
      '在教练确认安全的平地上，先不移动，感受双脚与雪板的位置关系。',
      '微屈膝、保持身体放松，让目光朝向准备移动的方向。',
      '请同伴或教练从侧面观察姿态，并根据反馈重新调整。',
    ],
    keyPoints: ['站姿应便于保持平衡和观察前方。', '根据教练反馈调整，不刻意僵直身体。'],
    commonMistakes: ['始终低头看雪板。', '膝盖和上身过于僵硬。'],
    criteria: [
      { id: 'intro-02-balance', text: '能在静止时保持稳定的基本站姿。' },
      { id: 'intro-02-gaze', text: '能保持目光观察前方而非持续低头。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-03', stageId: 'intro', order: 3, optional: false, prerequisiteIds: ['intro-02'],
    version: 1, reviewStatus: 'draft', title: '安全摔倒与站起',
    goal: '编辑草稿，待教练校对：在专业指导下学习摔倒后的自我保护和站起流程；截图中的动作细节尚未完成安全校对。',
    steps: [
      '先确认练习区域平缓、周围没有接近的滑行者，并请教练演示。',
      '在教练看护下练习摔倒后的停留与观察，不自行尝试未经示范的保护动作。',
      '确认雪板停止移动、周围安全后，按教练示范的方式站起。',
    ],
    keyPoints: ['保护动作与站起方式须由教练现场确认。', '摔倒后先观察周围，再决定是否起身。'],
    commonMistakes: ['未观察周围就立即起身。', '把未经校对的文字当成完整安全教学。'],
    criteria: [
      { id: 'intro-03-observe', text: '能在摔倒后先确认周围环境安全。' },
      { id: 'intro-03-guided-rise', text: '能在教练指导下完成站起练习。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-04', stageId: 'intro', order: 4, optional: false, prerequisiteIds: ['intro-03'],
    version: 1, reviewStatus: 'draft', title: '单脚带板滑行',
    goal: '编辑草稿：在平坦练习区体验一只脚固定时的平衡，并认识前刃侧蹬滑与后刃侧蹬滑。',
    steps: [
      '由教练确认平坦练习区与周围通行方向，固定一只脚。',
      '请教练示范前刃侧蹬滑，另一只脚轻推雪面，观察缓慢移动时的平衡。',
      '请教练示范后刃侧蹬滑，再在同一区域体验另一种方向的移动。',
      '每次都在安全距离内停下，回看起步与停止是否可控。',
    ],
    keyPoints: ['先看清前方再移动。', '移动速度以能随时安全停下为准。'],
    commonMistakes: ['没有观察周围就开始推行。', '为了前进距离而忽略停下动作。'],
    criteria: [
      { id: 'intro-04-start', text: '能在教练指导下分别尝试前刃与后刃单脚侧蹬起步。' },
      { id: 'intro-04-stop', text: '能在前刃与后刃侧蹬练习后，于指定平坦区域平稳停下。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-05', stageId: 'intro', order: 5, optional: false, prerequisiteIds: ['intro-04'],
    version: 1, reviewStatus: 'draft', title: '单脚带板蹬坡',
    goal: '编辑草稿：在教练指定的缓坡区域练习单脚带板向上移动和停稳。',
    steps: [
      '与教练确认坡度、边界和通行路线，避开滑行者的下行路线。',
      '保持一只脚固定，用另一只脚辅助向坡上移动。',
      '在约定位置停住，确认站稳后再继续或返回。',
    ],
    keyPoints: ['始终留意坡面上方与下方。', '感觉无法控制雪板时停止练习并求助。'],
    commonMistakes: ['在有下行者的路线中停留。', '移动时只看脚下，不观察坡面。'],
    criteria: [
      { id: 'intro-05-route', text: '能说明并遵守教练指定的蹬坡路线。' },
      { id: 'intro-05-pause', text: '能在约定位置停稳并观察周围。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-06', stageId: 'intro', order: 6, optional: true, prerequisiteIds: ['intro-05'],
    version: 1, reviewStatus: 'draft', title: '单脚滑坡 J 型弯',
    goal: '编辑草稿，待教练校对：选修体验单脚固定时的缓坡方向变化；可跳过本课继续必修路线。',
    steps: [
      '请教练选择适合的缓坡并示范单脚滑坡的进入和结束位置。',
      '在看护下体验雪板沿坡面移动，观察方向逐渐变化。',
      '到达约定区域后停下，与教练回看身体平衡和路线。',
    ],
    keyPoints: ['此课为选修，不作为后续必修前置。', '练习区域、动作与停止方式须经教练确认。'],
    commonMistakes: ['误以为选修课完成后才能学习推坡。', '未确认缓坡终点就进入滑行。'],
    criteria: [
      { id: 'intro-06-route', text: '能在教练指定范围内完成一次受控方向变化。' },
      { id: 'intro-06-stop', text: '能在约定区域安全停下。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-07', stageId: 'intro', order: 7, optional: false, prerequisiteIds: ['intro-05'],
    version: 1, reviewStatus: 'draft', title: '前／后刃推坡',
    goal: '编辑草稿，待教练校对：分别体验前刃与后刃推坡，并自查两种方向的控制。',
    steps: [
      '请教练在适合的缓坡演示后刃推坡，并说明安全停下的位置。',
      '在看护下练习后刃推坡，停稳后记录感受到的速度变化。',
      '请教练演示前刃推坡，再在同样的安全条件下练习并比较两种方向。',
    ],
    keyPoints: ['前刃与后刃分别练习、分别检查。', '任何方向失去控制时按教练指导结束练习。'],
    commonMistakes: ['只练习熟悉的一侧就勾选两侧考核。', '没有确认坡下空间便开始移动。'],
    criteria: [
      { id: 'intro-07-toe', text: '能在教练指定缓坡完成前刃推坡并停稳。' },
      { id: 'intro-07-heel', text: '能在教练指定缓坡完成后刃推坡并停稳。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-08', stageId: 'intro', order: 8, optional: false, prerequisiteIds: ['intro-07'],
    version: 1, reviewStatus: 'draft', title: '前／后刃落叶飘',
    goal: '编辑草稿，待教练校对：在前刃与后刃分别练习沿坡面改变横向移动方向。',
    steps: [
      '请教练先在缓坡示范后刃落叶飘的移动路线和停止方式。',
      '在指定范围内练习后刃向两侧移动，停下后确认路线。',
      '请教练再示范前刃方向，并在看护下完成对应练习。',
    ],
    keyPoints: ['前刃与后刃各自完成自查。', '路线和坡面使用规则以现场教练安排为准。'],
    commonMistakes: ['只完成后刃练习就认为两种方向都掌握。', '横向移动前未观察其他滑行者。'],
    criteria: [
      { id: 'intro-08-toe', text: '能在指定区域完成前刃落叶飘练习并停稳。' },
      { id: 'intro-08-heel', text: '能在指定区域完成后刃落叶飘练习并停稳。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-09', stageId: 'intro', order: 9, optional: false, prerequisiteIds: ['intro-08'],
    version: 1, reviewStatus: 'draft', title: 'J 型弯',
    goal: '编辑草稿，待教练校对：认识 J 型弯的路线，并在现场指导下完成受控转向。',
    steps: [
      '请教练示范本课的起点、转向路线和结束区域。',
      '在指定缓坡进入练习，观察雪板方向逐渐改变。',
      '在约定位置停稳，回看路线与速度是否保持可控。',
    ],
    keyPoints: ['转向练习以现场示范为准。', '保持对坡下和结束区域的观察。'],
    commonMistakes: ['未确认结束区域就开始滑行。', '以完成形状为目标而忽略速度控制。'],
    criteria: [
      { id: 'intro-09-turn', text: '能在教练指定路线完成一次受控 J 型转向。' },
      { id: 'intro-09-finish', text: '能在约定区域停稳。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-10', stageId: 'intro', order: 10, optional: false, prerequisiteIds: ['intro-09'],
    version: 1, reviewStatus: 'draft', title: 'C 型弯',
    goal: '编辑草稿，待教练校对：在教练指导下练习更完整的单次转向路线与停稳。',
    steps: [
      '先由教练演示本课的转向路线与安全边界。',
      '在教练指定缓坡完成单次转向，观察起点与终点的位置关系。',
      '停下后对照示范回看路线，确认下次练习的调整点。',
    ],
    keyPoints: ['先确认坡面空间和结束区域。', '练习次数与速度由现场教练安排。'],
    commonMistakes: ['转向中只关注雪板，忽略前方环境。', '未停稳就开始下一次尝试。'],
    criteria: [
      { id: 'intro-10-turn', text: '能沿教练指定区域完成一次受控 C 型转向。' },
      { id: 'intro-10-stop', text: '能在转向结束后安全停稳。' },
    ],
    source: 'editorial-draft', media: null,
  },
  {
    id: 'intro-11', stageId: 'intro', order: 11, optional: false, prerequisiteIds: ['intro-10'],
    version: 1, reviewStatus: 'draft', title: '初级基础 S 弯',
    goal: '编辑草稿，待教练校对：认识连续转向与换刃主题，在教练指导下完成入门阶段自查。',
    steps: [
      '请教练示范连续转向路线，并明确练习区域与结束位置。',
      '在看护下连接前一课的单次转向练习，观察每次方向变化。',
      '完成后停稳，与教练回看路线、换刃时机和对周围环境的观察。',
    ],
    keyPoints: ['连续转向和换刃动作须由教练现场校对。', '自评完成不等于技能认证。'],
    commonMistakes: ['为追求连续动作而超出可控速度。', '未经现场确认便在不适合的坡面练习。'],
    criteria: [
      { id: 'intro-11-link', text: '能在教练指定区域连接连续转向练习。' },
      { id: 'intro-11-edge', text: '能与教练复盘前后刃转换和停稳过程。' },
    ],
    source: 'editorial-draft', media: null,
  },
];

export function getLesson(lessonId: string): Lesson {
  const lesson = lessons.find(item => item.id === lessonId);
  if (!lesson) throw Object.assign(new Error('Lesson not found'), { code: 'NOT_FOUND' });
  return lesson;
}
