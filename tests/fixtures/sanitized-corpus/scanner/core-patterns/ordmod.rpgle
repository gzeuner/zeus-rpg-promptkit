**FREE
ctl-opt nomain bnddir('APPBNDDIR') bndsrvpgm('ORDERSRV');

dcl-pr ProcessOrder extproc('PROCESSORDER');
end-pr;

dcl-proc LocalExport export;
end-proc;
