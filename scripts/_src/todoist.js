'use strict';
// Todoist proxy (personal API token): tasks, projects and closing a task.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/data-feeds-offline.test.js.
module.exports = function registerTodoist({ path, fetchWithTimeout, app, db }) {
  // Was read-only originally; now also supports completing a task (the one
  // write this app needs — nothing else here creates/edits/deletes Todoist
  // data). Note: Todoist deprecated the old REST v2 API (api.todoist.com/rest/v2/...).
  // The current API lives under /api/v1/ and wraps list responses as { results: [...], next_cursor }.
  async function todoistGet(token, path) {
    let res;
    try {
      res = await fetchWithTimeout(`https://api.todoist.com${path}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeoutMs: 10000,
        timeoutMessage: 'Timed out contacting Todoist',
      });
    } catch (e) { throw { status: 500, message: e.message }; }
    if (res.status === 401 || res.status === 403) throw { status: 401, message: 'Invalid Todoist token' };
    if (res.status >= 400) throw { status: 500, message: `Todoist returned status ${res.status}` };
    let parsed;
    try { parsed = await res.json(); }
    catch { throw { status: 500, message: 'Failed to parse Todoist response' }; }
    // New API wraps results: { results: [...], next_cursor }. Treat bare arrays as already-unwrapped.
    return Array.isArray(parsed) ? parsed : (parsed.results || []);
  }

  // POST helper for the one write operation this app makes to Todoist —
  // completing a task. Same token/auth as todoistGet above, just a different
  // HTTP method; a real request body was never needed for /close (Todoist's
  // endpoint takes the task id from the URL path alone), so this stays a
  // simple no-body POST rather than a more general "send any payload" helper.
  async function todoistPost(token, path) {
    let res;
    try {
      res = await fetchWithTimeout(`https://api.todoist.com${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        timeoutMs: 10000,
        timeoutMessage: 'Timed out contacting Todoist',
      });
    } catch (e) { throw { status: 500, message: e.message }; }
    if (res.status === 401 || res.status === 403) throw { status: 401, message: 'Invalid Todoist token' };
    if (res.status >= 400) throw { status: 500, message: `Todoist returned status ${res.status}` };
    // A successful close returns 204 No Content — nothing to parse, and
    // trying to JSON.parse an empty body would throw for no reason.
    return true;
  }

  // GET /api/todoist/tasks?project_id=XXXX  (project_id optional — omit for all projects)
  app.get('/api/todoist/tasks', async (req, res) => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
    const token = row?.value;
    if (!token) return res.status(400).json({ error: 'No Todoist token configured — add one in Settings' });

    let path = '/api/v1/tasks';
    if (req.query.project_id) path += `?project_id=${encodeURIComponent(req.query.project_id)}`;

    try {
      const tasks = await todoistGet(token, path);
      res.json(tasks);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // POST /api/todoist/tasks/:id/close — marks a task complete on Todoist
  // itself, not just locally. This app never shows completed tasks again
  // once they're gone from Todoist's own "active tasks" list (there's no
  // local record of them to reopen from here), which is the right behavior
  // for a wall display — tapping a task off is meant to be the same as
  // checking it off in the real Todoist app, not a display-only hide.
  app.post('/api/todoist/tasks/:id/close', async (req, res) => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
    const token = row?.value;
    if (!token) return res.status(400).json({ error: 'No Todoist token configured — add one in Settings' });
    try {
      await todoistPost(token, `/api/v1/tasks/${encodeURIComponent(req.params.id)}/close`);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // GET /api/todoist/projects — used to populate the project picker dropdown
  app.get('/api/todoist/projects', async (req, res) => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
    const token = row?.value;
    if (!token) return res.status(400).json({ error: 'No Todoist token configured — add one in Settings' });

    try {
      const projects = await todoistGet(token, '/api/v1/projects');
      res.json(projects);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
  return { todoistGet };
};
