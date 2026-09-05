exports.createReceiver = () => { const ledger = new Set(); return { receive: (event) => ledger.add(event.id), count: () => ledger.size }; };
