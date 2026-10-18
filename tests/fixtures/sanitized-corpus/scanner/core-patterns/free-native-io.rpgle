**FREE
ctl-opt nomain;
dcl-f FREEFILE
  keyed usage(*update)
  rename(EXTREC:FREEREC);
chain(n) (1) FREEREC RESULTDS;
update(e) FREEREC %fields(QTY);
unlock FREEFILE;
update UNKNOWNREC;
// update FREEFILE;