# weak-listen
A less leak-prone way to manage event listeners
## Background
By far the most common source of memory leaks I've seen is components that call `addEventListener` and forget to call `removeEventListener`. This repository is an exploration of a different event listening strategy which wouldn't leak giant amounts of memory if you hold it wrong. ("An exploration" means "mostly untested and probably incorrect".)
## Pros
* Avoid a major source of leaks
* Simple, drop-in replacement for `addEventListener` supports the same options
## Cons
* There are still plenty of other ways to write leaks, so developers need to get familiar with memory analysis tools anyway
* This approach introduces two new ways to write functionality bugs that escape into the wild:
  * You expect an event listener to run, because your machine never GCed it during testing, but it doesn't run on a customer machine
  * You expect an event listener to not run, because it was reliably GCed in your testing, but it does run on a customer machine
* Takes more time and memory, despite my attempts to be efficient
* Makes stack traces a little more complicated
