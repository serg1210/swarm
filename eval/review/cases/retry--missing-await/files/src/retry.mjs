/**
 * Call `fn(attempt)` until it succeeds, at most `attempts` times. `fn` may be synchronous or
 * return a promise. Rejects with the last error when every attempt fails.
 */
export async function retry(fn, { attempts = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn(attempt);
    } catch (err) {
      if (attempt + 1 >= attempts) throw err;
    }
  }
}
