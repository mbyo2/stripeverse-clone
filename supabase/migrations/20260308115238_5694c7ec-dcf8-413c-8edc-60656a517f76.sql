-- Fix audit_trigger to handle tables without uuid_id column
CREATE OR REPLACE FUNCTION public.audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  record_identifier text;
BEGIN
  -- Safely get record ID, checking for uuid_id first, then id
  IF TG_OP = 'DELETE' THEN
    BEGIN
      record_identifier := OLD.uuid_id::text;
    EXCEPTION WHEN undefined_column THEN
      record_identifier := OLD.id::text;
    END;
  ELSE
    BEGIN
      record_identifier := NEW.uuid_id::text;
    EXCEPTION WHEN undefined_column THEN
      record_identifier := NEW.id::text;
    END;
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    table_name,
    record_id,
    old_values,
    new_values
  ) VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    record_identifier,
    CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;