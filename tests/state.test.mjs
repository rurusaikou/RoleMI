import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, failTask, resetTask, startTask, succeedTask, TASK_STATUS } from '../src/app/state.js';

test('Match 与 Revision 拥有独立四态状态机', () => {
  const state = createInitialState();
  assert.equal(state.tasks.resumeMatch.status, TASK_STATUS.IDLE);
  assert.equal(state.tasks.resumeRevision.status, TASK_STATUS.IDLE);

  startTask(state.tasks.resumeMatch);
  assert.equal(state.tasks.resumeMatch.status, TASK_STATUS.LOADING);
  assert.equal(state.tasks.resumeRevision.status, TASK_STATUS.IDLE);

  const matchResult = { level: '高匹配' };
  succeedTask(state.tasks.resumeMatch, matchResult);
  startTask(state.tasks.resumeRevision);
  assert.equal(state.tasks.resumeMatch.status, TASK_STATUS.SUCCESS);
  assert.equal(state.tasks.resumeRevision.status, TASK_STATUS.LOADING);
  assert.equal(state.tasks.resumeMatch.result, matchResult);

  failTask(state.tasks.resumeRevision, 'revision failed');
  assert.equal(state.tasks.resumeMatch.status, TASK_STATUS.SUCCESS);
  assert.equal(state.tasks.resumeRevision.status, TASK_STATUS.ERROR);
  assert.equal(state.tasks.resumeRevision.error, 'revision failed');

  resetTask(state.tasks.resumeRevision);
  assert.equal(state.tasks.resumeRevision.status, TASK_STATUS.IDLE);
});
