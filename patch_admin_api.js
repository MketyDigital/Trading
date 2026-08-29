import fs from 'fs';
let code = fs.readFileSync('cloudflare-v2/src/index.js', 'utf8');
code = code.replace(
    'return json({ error: "Admin endpoint not found" }, 404);',
    `
        // Generic DB Proxy for Dashboard (No RLS / Anon Key needed on frontend)
        if (path === "/api/admin/data/proxy" && method === "POST") {
            const { table, action, match, payload } = body;
            let query = supabase.from(table);
            
            if (action === "select") query = query.select('*').order('created_at', { ascending: false }).limit(50);
            if (action === "insert") query = query.insert(payload).select();
            if (action === "update") query = query.update(payload).match(match).select();
            if (action === "delete") query = query.delete().match(match);
            
            const { data, error } = await query;
            return error ? json({ error }, 400) : json(data);
        }
        
        return json({ error: "Admin endpoint not found" }, 404);
`
);
fs.writeFileSync('cloudflare-v2/src/index.js', code);
