exports.createReceiver = () => { const ledger = []; return { receive: (event) => ledger.push(event.id), count: () => ledger.length }; };
