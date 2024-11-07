const getGlobalMap = new WeakMap();
const buildInterceptorMap = new WeakMap();

// Similar to:
//
//   emitter.addEventListener(eventName, handler, options)
//
// but will not leak the handler if you forget to remove the listener. It will
// instead leak a small, fixed amount of data, which is a much better outcome.
//
// This function returns a registration token which can be passed to unlisten
// when you no longer want to listen for events.
//
// If you drop all references to the handler, including the reference from the
// registration token, then the handler can be garbage collected and will
// eventually stop receiving events.
//
// The options 'capture', 'once', 'passive', and 'signal' are supported.
export function listen(emitter, eventName, handler, options) {
  // The following code must support the following situation:
  //
  // * this module was loaded within an iframe
  // * `handler` was created within this iframe, so it contains an internal
  //   reference to the iframe's global scope
  // * `emitter` is an object from the containing frame, which should outlive
  //   the iframe
  // * the caller saves the registration token in a property on `window`
  //
  // If this function allocates anything in the most natural way, it could
  // accidentally keep the iframe alive. Instead, it must carefully allocate
  // Functions in the emitter's context.

  const Function = emitter?.constructor?.constructor;
  if (Function.name !== 'Function') {
    throw new Error('could not find Function constructor from emitter');
  }

  function getOrCreateFunction(map, ...args) {
    let f = map.get(Function);
    if (!f) {
      f = new Function(...args);
      map.set(Function, f);
    }
    return f;
  }

  const globalThis = getOrCreateFunction(getGlobalMap, 'return globalThis')();

  // The "interceptor" is a small wrapper function that calls the original
  // handler if the handler is still alive.
  const buildInterceptor = getOrCreateFunction(buildInterceptorMap,
      'return function eventInterceptor() {' +
        'var c = arguments.callee;' +
        'var handler = c.handler.deref();' +
        'if (handler) return handler.apply(this, arguments);' +
        'else c.emitter.removeEventListener(c.eventName, c, c.capture)' +
      '}');

  const interceptor = buildInterceptor();
  interceptor.handler = new globalThis.WeakRef(handler);
  interceptor.emitter = emitter;
  interceptor.capture = options === true || !!(options?.capture);
  interceptor.eventName = eventName;

  emitter.addEventListener(eventName, interceptor, options);

  return {interceptor, handler};
}

export function unlisten(registration) {
  const {interceptor} = registration;
  const {emitter, eventName, capture} = interceptor;
  emitter.removeEventListener(eventName, interceptor, capture);
}
