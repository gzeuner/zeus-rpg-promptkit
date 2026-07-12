**FREE
ctl-opt dftactgrp(*no);

dcl-s ID_001 packed(7:0);

dcl-proc MAIN;
  exec sql
    select ID
      into :ID_001
      from TABLE_100
      fetch first 1 row only;

  exec sql
    update TABLE_100
       set STATUS = 'READY'
     where ID = :ID_001;
end-proc;

