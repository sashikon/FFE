const queue = [];
let processing = false;

async function processNext() {
  if (queue.length === 0) { processing = false; return; }
  processing = true;
  const { fn, resolve, reject } = queue.shift();
  try { resolve(await fn()); } catch (e) { reject(e); }
  setImmediate(processNext);
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    if (!processing) processNext();
  });
}

function queueLength() { return queue.length + (processing ? 1 : 0); }

module.exports = { enqueue, queueLength };
