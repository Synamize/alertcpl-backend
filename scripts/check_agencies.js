require("dotenv").config();
const supabase = require("../config/supabaseClient");

async function checkAgencies() {
    const { data, error } = await supabase.from("agencies").select("*").limit(1);
    if (error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}

checkAgencies();
