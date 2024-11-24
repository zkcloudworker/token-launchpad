import dotenv from "dotenv";
import console from "console";
import "source-map-support/register";

dotenv.config({ path: ".env.test" });
Error.stackTraceLimit = Infinity;

global.console = console;
const logCopy = console.log.bind(console);

console.log = function () {
  const timestamp = "[" + new Date().toLocaleTimeString() + "] ";

  if (arguments.length) {
    const args = Array.prototype.slice.call(arguments, 0);

    if (typeof arguments[0] === "string") {
      args[0] = "%s" + arguments[0];
      args.splice(1, 0, timestamp);
      logCopy.apply(this, args);
    } else {
      logCopy(timestamp, args);
    }
  }
};
