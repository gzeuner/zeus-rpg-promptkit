-- IBM i Environment Discovery Queries (general onboarding)
-- Purpose:
--   1. Find source libraries (QRPGLESRC, QCLSRC, QDDSSRC etc.)
--   2. Discover application tables / files
--   3. Locate programs (*PGM) and objects
--   4. Obtain column metadata, keys, and sample data safely
--
-- How to use:
--   1. Load your environment (config/load-env.*)
--   2. Replace library/schema placeholders (BIB, APPLIB, APPDATA, MYLIB...)
--   3. Run with: zeus query-sql --profile YOURPROFILE --sql "..." --max-rows 100
--   4. Use results to feed fetch --source-lib, resolve-object, query-table, inspect-object
--
-- Related: docs/quickstart/onboarding-new-ibm-i.md
-- Common catalog views: QSYS2.SYSTABLES, SYSCOLUMNS, SYSKEYS, SYSCST, SYSTRIG

-- 1) Source file inventory - where is the RPG/CL/DDS/SQL code?

-- 1) Source file inventory across the known development libraries.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       TABLE_TYPE,
       SYSTEM_TABLE_SCHEMA,
       SYSTEM_TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA IN ('BIB', 'APPLIB', 'LIBDEV')
  AND TABLE_NAME IN (
    'QRPGLESRC',
    'QCPYSRC',
    'QCLSRC',
    'QCLLESRC',
    'QSQLSRC',
    'QSRVSRC',
    'QDDSSRC'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- 2) Application file inventory in the business-data libraries.
--    This helps confirm where physical and logical files exist.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       TABLE_TYPE,
       SYSTEM_TABLE_SCHEMA,
       SYSTEM_TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_SCHEMA IN ('APPDATA', 'APPLIB', 'LIBDEV')
  AND TABLE_NAME NOT IN (
    'QRPGLESRC',
    'QCPYSRC',
    'QCLSRC',
    'QCLLESRC',
    'QSQLSRC',
    'QSRVSRC',
    'QDDSSRC'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- 3) Locate a concrete file or table across APPDATA, APPLIB, LIBDEV.
--    Replace 'MEINTABLE' with the object you are investigating.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       TABLE_TYPE,
       SYSTEM_TABLE_SCHEMA,
       SYSTEM_TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_NAME = 'MEINTABLE'
  AND TABLE_SCHEMA IN ('APPDATA', 'APPLIB', 'LIBDEV')
ORDER BY TABLE_SCHEMA, TABLE_NAME;

-- 4) Column shape for one concrete table or file.
--    Replace APPDATA/MEINTABLE as needed.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       ORDINAL_POSITION,
       COLUMN_NAME,
       DATA_TYPE,
       LENGTH,
       NUMERIC_SCALE,
       IS_NULLABLE,
       COLUMN_TEXT,
       COLUMN_HEADING
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA = 'APPDATA'
  AND TABLE_NAME = 'MEINTABLE'
ORDER BY ORDINAL_POSITION;

-- 5) Search for likely ticket-relevant fields in the known business libraries.
SELECT TABLE_SCHEMA,
       TABLE_NAME,
       COLUMN_NAME,
       DATA_TYPE,
       LENGTH,
       COLUMN_TEXT
FROM QSYS2.SYSCOLUMNS
WHERE TABLE_SCHEMA IN ('APPDATA', 'APPLIB', 'LIBDEV')
  AND (
    COLUMN_NAME LIKE '%STATUS%'
    OR COLUMN_NAME LIKE '%NR%'
    OR COLUMN_NAME LIKE '%DATUM%'
    OR COLUMN_NAME LIKE '%USER%'
    OR COLUMN_NAME LIKE '%TIME%'
    OR COLUMN_NAME LIKE '%ID%'
  )
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;

-- 6) Source file object statistics.
--    Change OBJECT_NAME to QRPGLESRC, QDDSSRC, QSQLSRC, ... as needed.
SELECT OBJLIB,
       OBJNAME,
       OBJTYPE,
       OBJATTRIBUTE,
       OBJTEXT,
       OBJOWNER
FROM TABLE(
  QSYS2.OBJECT_STATISTICS(
    OBJECT_SCHEMA => '*ALLUSR',
    OBJECT_NAME => 'QRPGLESRC',
    OBJECT_TYPE_LIST => '*FILE'
  )
)
WHERE OBJLIB IN ('BIB', 'APPLIB', 'LIBDEV')
ORDER BY OBJLIB, OBJNAME;

-- 7) Program object lookup across the known libraries.
--    Replace MYPGM with the program under investigation.
SELECT OBJLIB,
       OBJNAME,
       OBJLONGNAME,
       OBJTYPE,
       OBJATTRIBUTE,
       OBJTEXT,
       OBJOWNER
FROM TABLE(
  QSYS2.OBJECT_STATISTICS(
    OBJECT_SCHEMA => '*ALLUSR',
    OBJECT_NAME => 'MYPGM',
    OBJECT_TYPE_LIST => '*PGM'
  )
)
WHERE OBJLIB IN ('BIB', 'APPLIB', 'LIBDEV')
ORDER BY OBJLIB, OBJNAME;

-- 8) Quick schema discovery when only the table name is known.
--    Replace MEINTABLE with the physical/logical file or SQL table name.
SELECT TABLE_SCHEMA,
       TABLE_NAME
FROM QSYS2.SYSTABLES
WHERE TABLE_NAME = 'MEINTABLE'
ORDER BY TABLE_SCHEMA, TABLE_NAME;