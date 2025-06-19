
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { method } = req;
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    switch (method) {
      case 'GET':
        if (action === 'features') {
          // Get all features
          const { data: features, error: featuresError } = await supabase
            .from('features')
            .select('*')
            .order('category', { ascending: true })
            .order('name', { ascending: true });

          if (featuresError) throw featuresError;

          return new Response(JSON.stringify({ features }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (action === 'tier-features') {
          const tier = url.searchParams.get('tier');
          if (!tier) {
            return new Response(JSON.stringify({ error: 'Tier parameter required' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const { data, error } = await supabase.rpc('get_tier_features', {
            p_tier: tier
          });

          if (error) throw error;

          return new Response(JSON.stringify({ features: data }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (action === 'user-access') {
          const userId = url.searchParams.get('user_id');
          const featureId = url.searchParams.get('feature_id');

          if (!userId || !featureId) {
            return new Response(JSON.stringify({ error: 'user_id and feature_id parameters required' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const { data, error } = await supabase.rpc('user_has_feature_access', {
            p_user_id: userId,
            p_feature_id: featureId
          });

          if (error) throw error;

          return new Response(JSON.stringify({ hasAccess: data }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        break;

      case 'POST':
        if (action === 'add-feature') {
          const body = await req.json();
          const { feature_id, name, description, category } = body;

          if (!feature_id || !name || !description || !category) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const { data, error } = await supabase
            .from('features')
            .insert([{ feature_id, name, description, category }])
            .select()
            .single();

          if (error) throw error;

          return new Response(JSON.stringify({ feature: data }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (action === 'assign-feature') {
          const body = await req.json();
          const { tier, feature_id } = body;

          if (!tier || !feature_id) {
            return new Response(JSON.stringify({ error: 'Missing tier or feature_id' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const { data, error } = await supabase
            .from('tier_features')
            .insert([{ tier, feature_id }])
            .select()
            .single();

          if (error) throw error;

          return new Response(JSON.stringify({ assignment: data }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        break;

      case 'DELETE':
        if (action === 'remove-feature-assignment') {
          const tier = url.searchParams.get('tier');
          const featureId = url.searchParams.get('feature_id');

          if (!tier || !featureId) {
            return new Response(JSON.stringify({ error: 'Missing tier or feature_id' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const { error } = await supabase
            .from('tier_features')
            .delete()
            .eq('tier', tier)
            .eq('feature_id', featureId);

          if (error) throw error;

          return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        break;

      default:
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Feature management error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
})
