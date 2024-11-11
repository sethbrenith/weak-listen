const weakRefGetters = new WeakMap();
const setGetters = new WeakMap();
const interceptorBuilders = new WeakMap();
const abortListenerBuilders = new WeakMap();

const emptyOptions = {};
const optionsWithCapture = {capture: true};

// Returns an object with options. The returned object will behave like the
// original options during https://dom.spec.whatwg.org/#event-flatten-more .
function normalizeOptions(options) {
  if (typeof options === 'boolean') {
    return options ? optionsWithCapture : emptyOptions;
  }
  return typeof options === 'object' && options !== null ?
      options :
      emptyOptions;
}

function findAbortListener(emitter, eventName, handler, options) {
  const abortListeners = handler.abortListeners;
  if (!abortListeners) return;
  for (const listener of abortListeners) {
    const interceptor = listener.interceptor.deref();
    if (!interceptor) continue;
    if (interceptor.emitter === emitter &&
        interceptor.eventName === eventName &&
        interceptor.capture === options.capture) {
      return listener;
    }
  }
}

// Equivalent to emitter.addEventListener(eventName, handler, options)
// but will not leak the handler if you forget to remove the listener. It will
// instead leak a small, fixed amount of data, which is a much better outcome.
//
// The normal options 'capture', 'signal', and 'passive' are supported. The
// 'once' option is not yet supported.
//
// To unregister, you cannot call removeEventListener; you must call unlisten
// or use an AbortSignal.
export function listen(emitter, eventName, handler, options) {
  options = normalizeOptions(options);
  const abortSignal = options.signal;

  // The basic goal is to make `handler` be retained by `abortSignal` instead of
  // being retained by `emitter`. We'll construct the following object graph,
  // where any reference between the right and left halves must be weak:
  //
  //      abortSignal                          emitter
  //       |       ^                            |   ^
  //       |       |                            |   |
  //       |    WeakRef                         |   |
  //       |       ^                            |   |
  //       V       |                            V   |
  //     abortListener---->WeakRef - - - - > interceptor
  //        |     ^                               |
  //        |     |                               |
  //        |   abortListeners                    |
  //        |     ^                               |
  //        V     |                               V
  //        handler <- - - - - - - - - - - - - WeakRef
  //
  // `abortSignal` is optional, so just ignore the top-left corner of that graph
  // if one is not provided. In that case, the caller is responsible for keeping
  // `handler` alive.
  //
  // The `interceptor` is a function which uses a WeakRef to call the original
  // `handler` function only if `handler` is still alive. The `abortListener`
  // listens for the 'abort' event and handles it by unregistering both the
  // interceptor and itself, and removing itself from the `abortListeners` set.
  //
  // All of those newly created objects (including functions and WeakRefs) will
  // contain strong references to the global scope in which they were created.
  // "Global scope" here refers to something like an iframe or Realm which has
  // its own globalThis object. To avoid leaking global scopes, we must
  // carefully ensure that `emitter` and `handler` only point to other
  // objects created within their own global scopes.

  // First, check few things required by
  // https://dom.spec.whatwg.org/#add-an-event-listener .
  if (abortSignal?.aborted || !handler) return;
  if (findAbortListener(emitter, eventName, handler, options)) return;

  // The Function constructor lets us build stuff in the emitter's global scope.
  let Function = emitter.constructor.constructor;

  function getOrCreateFunction(map, body) {
    let f = map.get(Function);
    if (!f) {
      f = new Function(body);
      map.set(Function, f);
    }
    return f;
  }

  let WeakRef = getOrCreateFunction(weakRefGetters, 'return WeakRef')();
  const buildInterceptor = getOrCreateFunction(interceptorBuilders,
      'return function eventInterceptor() {' +
        'var i = arguments.callee;' +
        'var handler = i.handler.deref();' +
        'if (handler) return handler.apply(this, arguments);' +
        'else i.emitter.removeEventListener(i.eventName, i, i.capture);' +
      '}');
  const interceptor = buildInterceptor();
  interceptor.handler = new WeakRef(handler);
  interceptor.emitter = emitter;
  interceptor.capture = options.capture;
  interceptor.eventName = eventName;
  // TODO if 'once' was specified, the interceptor should also clean up the
  // abortListener (probably by just calling it).

  // We're done building things in the emitter's global scope. Next, we'll
  // build things in the handler's global scope.
  Function = handler.constructor.constructor;
  WeakRef = getOrCreateFunction(weakRefGetters, 'return WeakRef')();

  let abortListeners = handler.abortListeners;
  if (!abortListeners) {
    const Set = getOrCreateFunction(setGetters, 'return Set')();
    abortListeners = new Set();
    Object.defineProperty(
        handler, 'abortListeners', {value: abortListeners, enumerable: false});
  }

  const buildAbortListener = getOrCreateFunction(abortListenerBuilders,
      'return function abortListener() {' +
        'var c = arguments.callee;' +
        'c.handler.abortListeners.delete(c);' +
        'var abortSignal = c.abortSignal?.deref();' +
        'if (abortSignal) abortSignal.removeEventListener("abort", c);' +
        'var i = c.interceptor.deref();' +
        'if (i) i.emitter.removeEventListener(i.eventName, i, i.capture);' +
      '}');
  const abortListener = buildAbortListener();
  abortListener.handler = handler;
  abortListener.interceptor = new WeakRef(interceptor);
  if (abortSignal) {
    abortSignal.addEventListener('abort', abortListener);
    abortListener.abortSignal = new WeakRef(abortSignal);
  }
  abortListeners.add(abortListener);

  if (options.signal) {
    options = {...options, signal: undefined};
  }
  emitter.addEventListener(eventName, interceptor, options);
}

// Equivalent to emitter.removeEventListener(eventName, handler, options)
// for listeners registered using listen().
export function unlisten(emitter, eventName, handler, options) {
  options = normalizeOptions(options);
  const abortListener = findAbortListener(emitter, eventName, handler, options);
  if (abortListener) abortListener();
}
