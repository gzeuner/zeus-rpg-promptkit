ctl-opt dftactgrp(*no);

dcl-f INVOICE disk;

dcl-proc main;
  exec sql
    update INVOICE
       set STATUS = 'READY'
     where STATUS = 'NEW';
end-proc;
