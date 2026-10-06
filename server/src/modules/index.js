// Customer extensions live here. Hooks run inside the ticket transaction.
// Throwing aborts the transaction. Keep integrations in a durable outbox rather than making network calls here.
export const modules = [];
export async function runHook(name, context) {
  for (const module of modules) {
    if (
      context.config.modules[module.name] &&
      typeof module[name] === "function"
    )
      await module[name](context);
  }
}
