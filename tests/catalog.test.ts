import test from 'node:test';
import assert from 'node:assert/strict';
import { getLesson, lessons } from '../src/catalog/intro';

const expected = [
  ['intro-01', '单板滑雪装备介绍', false, null],
  ['intro-02', '滑行的基本站姿', false, 'intro-01'],
  ['intro-03', '安全摔倒与站起', false, 'intro-02'],
  ['intro-04', '单脚带板滑行', false, 'intro-03'],
  ['intro-05', '单脚带板蹬坡', false, 'intro-04'],
  ['intro-06', '单脚滑坡 J 型弯', true, 'intro-05'],
  ['intro-07', '前／后刃推坡', false, 'intro-05'],
  ['intro-08', '前／后刃落叶飘', false, 'intro-07'],
  ['intro-09', 'J 型弯', false, 'intro-08'],
  ['intro-10', 'C 型弯', false, 'intro-09'],
  ['intro-11', '初级基础 S 弯', false, 'intro-10'],
] as const;

test('目录包含截图确认的 11 个标题、顺序和前置关系', () => {
  assert.equal(lessons.length, 11);
  assert.deepEqual(
    [...lessons].sort((a, b) => a.order - b.order).map(({ id, title, optional, prerequisiteIds }) =>
      [id, title, optional, prerequisiteIds[0] ?? null]),
    expected,
  );
  assert.equal(new Set(lessons.map(lesson => lesson.id)).size, lessons.length);
  assert.equal(new Set(lessons.map(lesson => lesson.order)).size, lessons.length);
});

test('必修依赖无环，移除选修后仍可从首课到终课', () => {
  const byId = new Map(lessons.map(lesson => [lesson.id, lesson]));
  for (const lesson of lessons) {
    const visited = new Set<string>();
    const visit = (id: string): void => {
      assert.equal(visited.has(id), false, `${lesson.id} has cyclic prerequisites`);
      visited.add(id);
      const prerequisite = byId.get(id);
      assert.ok(prerequisite, `${id} must exist`);
      prerequisite.prerequisiteIds.forEach(visit);
      visited.delete(id);
    };
    visit(lesson.id);
  }

  const required = lessons.filter(lesson => !lesson.optional).sort((a, b) => a.order - b.order);
  const done = new Set<string>();
  for (const lesson of required) {
    assert.ok(lesson.prerequisiteIds.every(id => done.has(id)), `${lesson.id} is reachable`);
    done.add(lesson.id);
  }
  assert.equal(done.has('intro-11'), true);
  assert.equal(done.has('intro-06'), false);
});

test('每课有可用且稳定的考核 ID，合并课程覆盖前后刃', () => {
  for (const lesson of lessons) {
    assert.ok(lesson.goal.trim());
    assert.ok(lesson.steps.length > 0);
    assert.ok(lesson.keyPoints.length > 0);
    assert.ok(lesson.commonMistakes.length > 0);
    assert.ok(lesson.criteria.length > 0);
    assert.equal(new Set(lesson.criteria.map(criterion => criterion.id)).size, lesson.criteria.length);
    for (const criterion of lesson.criteria) {
      assert.ok(criterion.id.startsWith(`${lesson.id}-`));
      assert.ok(criterion.text.trim());
    }
  }
  for (const id of ['intro-07', 'intro-08']) {
    const lesson = getLesson(id);
    assert.ok(lesson.criteria.some(criterion => criterion.text.includes('前刃')));
    assert.ok(lesson.criteria.some(criterion => criterion.text.includes('后刃')));
  }
});

test('考核 ID 与持久记录约定一致', () => {
  const expectedIds: Record<string, string[]> = {
    'intro-01': ['intro-01-name', 'intro-01-check'],
    'intro-02': ['intro-02-balance', 'intro-02-gaze'],
    'intro-03': ['intro-03-observe', 'intro-03-guided-rise'],
    'intro-04': ['intro-04-start', 'intro-04-stop'],
    'intro-05': ['intro-05-route', 'intro-05-pause'],
    'intro-06': ['intro-06-route', 'intro-06-stop'],
    'intro-07': ['intro-07-toe', 'intro-07-heel'],
    'intro-08': ['intro-08-toe', 'intro-08-heel'],
    'intro-09': ['intro-09-turn', 'intro-09-finish'],
    'intro-10': ['intro-10-turn', 'intro-10-stop'],
    'intro-11': ['intro-11-link', 'intro-11-edge'],
  };
  for (const [lessonId, ids] of Object.entries(expectedIds)) {
    assert.deepEqual(getLesson(lessonId).criteria.map(criterion => criterion.id), ids);
  }
});

test('单脚带板滑行分别讲解并考核前后刃侧蹬滑', () => {
  const lesson = getLesson('intro-04');
  for (const edge of ['前刃', '后刃']) {
    assert.ok(lesson.steps.some(step => step.includes(edge)), `${edge} must be taught`);
    assert.ok(lesson.criteria.some(criterion => criterion.text.includes(edge)), `${edge} must be assessed`);
  }
});

test('课程是待审核草稿且不展示虚构媒体', () => {
  for (const lesson of lessons) {
    assert.equal(lesson.reviewStatus, 'draft');
    assert.equal(lesson.media, null);
  }
  for (const id of ['intro-03', 'intro-09', 'intro-10', 'intro-11']) {
    assert.match(getLesson(id).goal, /草稿|待教练校对/);
  }
});

test('未知课程抛出 NOT_FOUND', () => {
  assert.throws(() => getLesson('missing'), { code: 'NOT_FOUND' });
});
