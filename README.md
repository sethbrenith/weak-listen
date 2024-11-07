# weak-listen
A less leak-prone way to manage event listeners
## Background
By far the most common source of memory leaks I've seen is components that call `addEventListener` and forget to call `removeEventListener`. This repository is an exploration of a different event listening strategy which wouldn't leak giant amounts of memory if you hold it wrong.
## Pros
* Avoid a major source of leaks
## Cons
* Doesn't play well with other libraries
* There are still plenty of other ways to write leaks, so developers need to get familiar with memory analysis tools anyway
* If you forget to store the registration token somewhere, then the event handler will just stop responding at some point, so this approach introduces a new way to write bugs
* Makes stack traces a little more complicated
